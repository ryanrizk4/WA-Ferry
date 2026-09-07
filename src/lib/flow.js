// Driving the WSF Vehicle Reservations System (VRS).
//
// VRS is ASP.NET WebForms with UpdatePanels: changing the departing terminal
// fires an async postback that repopulates the arriving terminal, and
// "Show Availability" posts the whole form. That shape dictates the approach
// here — set a field, wait for the partial postback to settle, then move on.
// Field names came from watching the real form post during recon.

export const F = {
  fromTerm: '#MainContent_dlFromTermList',
  toTerm: '#MainContent_dlToTermList',
  date: '#MainContent_txtDatePicker',
  vehicle: '#MainContent_dlVehicle',
  // The height dropdown depends on the length chosen. For "under 22 feet"
  // (value 3) the live control is this one, inside the .vehShow3 block;
  // dlTempHeight exists on the page but is not the one being validated.
  height: '#MainContent_ddlCarTruck14To22',
  schedule: '#schedule',
  showAvailability: '#MainContent_linkBtnContinue',
  startOver: '#MainContent_linkBtnStartOver',
};

export const VALUES = {
  orcasIsland: '15',
  anacortes: '1',
  vehicleUnder22: '3',
  heightUpTo72: '1000',
};

// default.aspx is a marketing/login home page; the search form lives one click
// deeper. Going straight there saves a postback, which matters when the whole
// point is to be early.
export const START_URL =
  'https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx';
const HOME_MAKE_RESERVATION = '#linkBtnContinue';

// Waiting for the UpdatePanel to finish its partial postback.
//
// Do NOT use networkidle here. These pages hold open analytics beacons to
// Google and Azure that never go quiet, so networkidle burns its full timeout
// on every single step — around a hundred wasted seconds per search, which is
// the difference between winning a 7 a.m. release and missing it.
//
// ASP.NET AJAX tells us directly whether a postback is in flight, so ask it.
async function settle(page, ms = 250) {
  await page.waitForFunction(() => {
    const prm = window.Sys?.WebForms?.PageRequestManager;
    if (!prm) return true; // no AJAX on this page; nothing to wait for
    return !prm.getInstance().get_isInAsyncPostBack();
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

export async function openSearch(page) {
  await page.goto(START_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await settle(page);

  // A cookie check or session timeout can bounce us back to the home page.
  // If that happens, click through rather than failing the run.
  const haveForm = await page.locator(F.fromTerm).count();
  if (!haveForm) {
    const home = await page.locator(HOME_MAKE_RESERVATION).count();
    if (home) {
      await page.click(HOME_MAKE_RESERVATION);
      await settle(page);
    }
  }
  await page.waitForSelector(F.fromTerm, { timeout: 20000 });
  return page.url();
}

export async function setRoute(page, fromValue, toValue) {
  await page.selectOption(F.fromTerm, fromValue);
  // The arriving list is repopulated by the server; wait for the option to
  // actually exist rather than guessing at a delay.
  await page.waitForFunction(
    (v) => {
      const s = document.querySelector('#MainContent_dlToTermList');
      return s && [...s.options].some((o) => o.value === v);
    },
    toValue,
    { timeout: 20000 },
  );
  await page.selectOption(F.toTerm, toValue);
  await settle(page);
}

// The date box is a jQuery UI datepicker and is often readonly, so a plain
// fill() can fail. Setting the value directly and firing the events WebForms
// listens for works whether or not the widget cooperates.
export async function setDate(page, mmddyyyy) {
  const ok = await page.fill(F.date, mmddyyyy, { timeout: 5000 })
    .then(() => true).catch(() => false);
  if (!ok) {
    await page.evaluate((v) => {
      const el = document.querySelector('#MainContent_txtDatePicker');
      el.removeAttribute('readonly');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, mmddyyyy);
  }
  // Close any datepicker overlay so it cannot intercept the next click.
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page);
  return page.inputValue(F.date).catch(() => '<unreadable>');
}

export async function setVehicle(page, lengthValue, heightValue) {
  await page.selectOption(F.vehicle, lengthValue);
  await settle(page);
  // The height control is only rendered once a length is chosen, so wait for
  // it rather than swallowing the failure — a missed height silently blocks
  // the search behind "Please Select Vehicle Height".
  await page.waitForSelector(F.height, { timeout: 15000 });
  await page.selectOption(F.height, heightValue);
  await settle(page);
}

// The red text next to each field. When a search refuses to run, this says
// exactly which field the server rejected.
export async function readValidation(page) {
  return page.evaluate(() => {
    const ids = ['MainContent_cvFromTerm', 'MainContent_cvToTerm', 'MainContent_cvTravelDate',
      'MainContent_cvVehicleLength', 'MainContent_cvVehicleHeight', 'MainContent_rfvCarTruck14To22',
      'MainContent_regxCarTruck14To22'];
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const st = getComputedStyle(el);
      const shown = st.visibility !== 'hidden' && st.display !== 'none';
      const msg = (el.innerText || '').trim();
      if (shown && msg) out[id.replace('MainContent_', '')] = msg;
    }
    return out;
  });
}

export async function showAvailability(page) {
  await page.click(F.showAvailability, { timeout: 15000 });
  await settle(page, 600);
}

// Anything that looks like a bot check. Worth knowing about separately from a
// generic failure, because it changes what is possible rather than what is
// broken.
export async function detectCaptcha(page) {
  return page.evaluate(() => {
    const sels = [
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[title*="captcha" i]',
      '[class*="captcha" i]', '[id*="captcha" i]', 'img[src*="captcha" i]',
      '.g-recaptcha', '#g-recaptcha-response',
    ];
    const found = [];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        found.push({
          sel: s,
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          visible: r.width > 0 && r.height > 0,
          src: (el.getAttribute('src') || '').slice(0, 140),
        });
      }
    }
    const flag = document.querySelector('input[name*="isShowCaptcha" i]');
    return { found, isShowCaptchaValue: flag ? flag.value : null };
  });
}

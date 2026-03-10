// Netlify serverless function — proxies Acuity Scheduling API
// Credentials stored as Netlify env vars: ACUITY_USER_ID, ACUITY_API_KEY

// Ski school timezone — appointments are displayed/filtered in this timezone
const SCHOOL_TZ = 'Asia/Tokyo';

exports.handler = async function(event) {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;

  if (!userId || !apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Acuity credentials not configured. Add ACUITY_USER_ID and ACUITY_API_KEY in Netlify environment variables.' })
    };
  }

  const params = event.queryStringParameters || {};
  let range;
  let filterDate = null; // if set, only return appointments on this date in SCHOOL_TZ

  if (params.date) {
    // Single day: ?date=2026-03-10
    // Acuity stores times in its calendar's configured timezone (often US time).
    // A lesson at 9am Japan time appears as the previous day in US timezones.
    // Query one extra day back so we catch all timezone-shifted appointments,
    // then filter to the correct local date below.
    filterDate = params.date;
    range = { min: shiftDate(params.date, -1), max: params.date };
  } else if (params.month) {
    // Full month: ?month=March+2026 (kept for backward compat)
    range = parseMonth(params.month);
    if (!range) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid month parameter: "' + params.month + '". Expected format: "March 2026"' })
      };
    }
  } else {
    // Default: today in SCHOOL_TZ
    var todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: SCHOOL_TZ });
    filterDate = todayStr;
    range = { min: shiftDate(todayStr, -1), max: todayStr };
  }

  const auth = Buffer.from(userId + ':' + apiKey).toString('base64');
  let allAppts = [];
  let offset = 0;
  const pageSize = 500;

  try {
    // Paginate through all appointments for the date range (including cancelled)
    while (true) {
      const url = 'https://acuityscheduling.com/api/v1/appointments'
        + '?minDate=' + range.min
        + '&maxDate=' + range.max
        + '&max=' + pageSize
        + '&offset=' + offset
        + '&canceled=true';

      const res = await fetch(url, {
        headers: { 'Authorization': 'Basic ' + auth }
      });

      if (!res.ok) {
        const text = await res.text();
        return { statusCode: res.status, body: JSON.stringify({ error: 'Acuity API error: ' + text }) };
      }

      const page = await res.json();
      if (!Array.isArray(page)) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected Acuity response: ' + JSON.stringify(page) }) };
      }

      allAppts = allAppts.concat(page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    // When filtering to a specific date, keep only appointments on that date in SCHOOL_TZ
    if (filterDate) {
      allAppts = allAppts.filter(function(a) {
        if (!a.datetime) return false;
        try {
          var localDate = new Date(a.datetime).toLocaleDateString('sv-SE', { timeZone: SCHOOL_TZ });
          return localDate === filterDate;
        } catch(e) {
          return true;
        }
      });
    }

    // Transform Acuity API objects into the CSV row format the dashboard expects
    const rows = allAppts.map(function(a) {
      return {
        'Appointment ID': String(a.id || ''),
        'First Name':     a.firstName  || '',
        'Last Name':      a.lastName   || '',
        'Start Time':     fmtDate(a.datetime),
        'End Time':       fmtDate(a.endTime),
        'Type':           a.type       || '',
        'Calendar':       a.calendar   || '',
        'Appointment Price':   String(a.price      || 0),
        'Amount Paid Online':  String(a.amountPaid || 0),
        'Paid?':          a.paid      ? 'yes' : 'no',
        'Canceled':       a.canceled  ? 'canceled' : '',
        'Date Canceled':  a.canceledAt ? String(a.canceledAt).substring(0, 10) : ''
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(rows)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// Shift a YYYY-MM-DD date string by N days
function shiftDate(dateStr, days) {
  var d = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids DST edge cases
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Parse "March 2026" → { min: "2026-03-01", max: "2026-03-31" }
function parseMonth(str) {
  if (!str) return null;
  var months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  var parts = str.trim().split(/\s+/);
  if (parts.length < 2) return null;
  var mi = months.indexOf(parts[0].toLowerCase());
  var yr = parseInt(parts[parts.length - 1]);
  if (mi < 0 || isNaN(yr)) return null;
  var last = new Date(yr, mi + 1, 0).getDate();
  var mm = String(mi + 1).padStart(2, '0');
  return {
    min: yr + '-' + mm + '-01',
    max: yr + '-' + mm + '-' + String(last).padStart(2, '0')
  };
}

// Convert ISO datetime to "YYYY-MM-DD HH:mm" in the school's local timezone
// e.g. "2026-03-09T21:00:00-0800" (Pacific) → "2026-03-10 14:00" (JST)
function fmtDate(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    // sv-SE locale reliably produces "YYYY-MM-DD" and "HH:mm:ss"
    var datePart = d.toLocaleDateString('sv-SE', { timeZone: SCHOOL_TZ });
    var timePart = d.toLocaleTimeString('sv-SE', { timeZone: SCHOOL_TZ }).slice(0, 5);
    return datePart + ' ' + timePart;
  } catch(e) {
    var m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    return m ? m[1] + ' ' + m[2] : String(iso);
  }
}

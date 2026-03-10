// Vercel serverless function — proxies Acuity Scheduling API
// Credentials stored as Vercel env vars: ACUITY_USER_ID, ACUITY_API_KEY

const SCHOOL_TZ = 'Asia/Tokyo';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;

  if (!userId || !apiKey) {
    return res.status(500).json({ error: 'Acuity credentials not configured. Add ACUITY_USER_ID and ACUITY_API_KEY in Vercel environment variables.' });
  }

  const params = req.query || {};
  let range;
  let filterDate = null;

  if (params.date) {
    filterDate = params.date;
    range = { min: shiftDate(params.date, -1), max: params.date };
  } else if (params.month) {
    range = parseMonth(params.month);
    if (!range) {
      return res.status(400).json({ error: 'Invalid month parameter: "' + params.month + '"' });
    }
  } else {
    var todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: SCHOOL_TZ });
    filterDate = todayStr;
    range = { min: shiftDate(todayStr, -1), max: todayStr };
  }

  const auth = Buffer.from(userId + ':' + apiKey).toString('base64');
  const pageSize = 500;

  async function fetchAll(baseUrl) {
    var results = [];
    var offset = 0;
    while (true) {
      var url = baseUrl + '&max=' + pageSize + '&offset=' + offset;
      var response = await fetch(url, { headers: { 'Authorization': 'Basic ' + auth } });
      if (!response.ok) {
        var text = await response.text();
        throw new Error('Acuity API error (' + response.status + '): ' + text);
      }
      var page = await response.json();
      if (!Array.isArray(page)) throw new Error('Unexpected Acuity response: ' + JSON.stringify(page));
      results = results.concat(page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return results;
  }

  var baseUrl = 'https://acuityscheduling.com/api/v1/appointments'
    + '?minDate=' + range.min
    + '&maxDate=' + range.max;

  try {
    var active    = await fetchAll(baseUrl);
    var cancelled = await fetchAll(baseUrl + '&canceled=true');

    var byId = {};
    active.forEach(function(a) { byId[a.id] = a; });
    cancelled.forEach(function(a) { byId[a.id] = a; });
    var allAppts = Object.values(byId);

    if (filterDate) {
      allAppts = allAppts.filter(function(a) {
        if (!a.datetime) return false;
        try {
          var localDate = new Date(a.datetime).toLocaleDateString('sv-SE', { timeZone: SCHOOL_TZ });
          return localDate === filterDate;
        } catch(e) { return true; }
      });
    }

    var rows = allAppts.map(function(a) {
      return {
        'Appointment ID':      String(a.id || ''),
        'First Name':          a.firstName  || '',
        'Last Name':           a.lastName   || '',
        'Start Time':          fmtDate(a.datetime),
        'End Time':            fmtDate(a.endTime),
        'Type':                a.type       || '',
        'Calendar':            a.calendar   || '',
        'Appointment Price':   String(a.price      || 0),
        'Amount Paid Online':  String(a.amountPaid || 0),
        'Paid?':               a.paid      ? 'yes' : 'no',
        'Canceled':            a.canceled  ? 'canceled' : '',
        'Date Canceled':       a.canceledAt ? String(a.canceledAt).substring(0, 10) : ''
      };
    });

    return res.status(200).json(rows);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function shiftDate(dateStr, days) {
  var d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  return { min: yr + '-' + mm + '-01', max: yr + '-' + mm + '-' + String(last).padStart(2, '0') };
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var datePart = d.toLocaleDateString('sv-SE', { timeZone: SCHOOL_TZ });
    var timePart = d.toLocaleTimeString('sv-SE', { timeZone: SCHOOL_TZ }).slice(0, 5);
    return datePart + ' ' + timePart;
  } catch(e) {
    var m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    return m ? m[1] + ' ' + m[2] : String(iso);
  }
}

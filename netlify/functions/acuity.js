// Netlify serverless function ‚Äî proxies Acuity Scheduling API
// Credentials stored as Netlify env vars: ACUITY_USER_ID, ACUITY_API_KEY

exports.handler = async function(event) {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;

  if (!userId || !apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Acuity credentials not configured. Add ACUITY_USER_ID and ACUITY_API_KEY in Netlify environment variables.' })
    };
  }

  const monthStr = (event.queryStringParameters || {}).month || '';
  const range = parseMonth(monthStr);
  if (!range) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid month parameter: "' + monthStr + '". Expected format: "March 2026"' })
    };
  }

  const auth = Buffer.from(userId + ':' + apiKey).toString('base64');
  let allAppts = [];
  let offset = 0;
  const pageSize = 500;

  try {
    // Paginate through all appointments for the month (including cancelled)
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// Parse "March 2026" ‚Üí { min: "2026-03-01", max: "2026-03-31" }
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

// Convert ISO datetime "2026-03-09T10:00:00-0700" ‚Üí "2026-03-09 10:00"
function fmtDate(iso) {
  if (!iso) return '';
  var m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? m[1] + ' ' + m[2] : String(iso);
}

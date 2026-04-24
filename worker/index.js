const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

function parseNumber(str) {
  if (!str) return 0;
  return parseInt(str.replace(/,/g, ''), 10) || 0;
}

function parseHeaderTag(html) {
  const match = html.match(/<shreddit-subreddit-header\s[^>]*>/s);
  if (!match) return null;

  const tag = match[0];
  return {
    weekly_visitors: parseNumber(tag.match(/weekly-active-users="([^"]+)"/)?.[1]),
    weekly_contributions: parseNumber(tag.match(/weekly-contributions="([^"]+)"/)?.[1]),
  };
}

/**
 * Reddit serves a JS challenge: (async e => e+e)("hex").
 * Solve it, then re-fetch with cookies + Referer to get the real page.
 * Returns { html, cookies } so cookies can be reused for about.json.
 */
async function fetchRedditPage(sub) {
  const pageUrl = `https://www.reddit.com/r/${sub}/`;

  const challengeRes = await fetch(pageUrl, { headers: BROWSER_HEADERS, redirect: 'follow', cf: { cacheTtl: 0 } });
  const challengeHtml = await challengeRes.text();

  if (!challengeHtml.includes('Please wait for verification')) {
    return { html: challengeHtml, cookies: '' };
  }

  const canonicalUrl = challengeRes.url || pageUrl;

  const challengeMatch = challengeHtml.match(/\("([0-9a-f]+)"\)/);
  if (!challengeMatch) return { html: challengeHtml, cookies: '' };

  const input = challengeMatch[1];
  const solution = input + input;

  const tokenMatch = challengeHtml.match(/name="token"\s+value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';

  const cookies = challengeRes.headers.getAll('set-cookie')
    .map(c => c.split(';')[0])
    .join('; ');

  const params = new URLSearchParams({ solution, js_challenge: '1', token, jsc_orig_r: '' });
  const solvedRes = await fetch(`${canonicalUrl}?${params}`, {
    headers: {
      ...BROWSER_HEADERS,
      'Referer': canonicalUrl,
      'Cookie': cookies,
    },
    redirect: 'follow',
    cf: { cacheTtl: 0 },
  });

  // Merge cookies from both responses
  const solvedCookies = solvedRes.headers.getAll('set-cookie')
    .map(c => c.split(';')[0])
    .join('; ');
  const allCookies = [cookies, solvedCookies].filter(Boolean).join('; ');

  return { html: await solvedRes.text(), cookies: allCookies };
}

async function fetchSubredditStats(sub) {
  let members = 0, weekly_visitors = 0, weekly_contributions = 0;
  let sessionCookies = '';

  // Fetch page HTML (solving challenge) for weekly stats
  try {
    const { html, cookies } = await fetchRedditPage(sub);
    sessionCookies = cookies;
    const stats = parseHeaderTag(html);
    if (stats) {
      weekly_visitors = stats.weekly_visitors;
      weekly_contributions = stats.weekly_contributions;
    }
  } catch {}

  // about.json for subscriber count (try without cookies first, then with)
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/about.json`, {
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
      cf: { cacheTtl: 0 },
    });
    const json = await res.json();
    members = json?.data?.subscribers ?? 0;
  } catch {}

  if (members === 0 && sessionCookies) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/about.json`, {
        headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], 'Cookie': sessionCookies },
        cf: { cacheTtl: 0 },
      });
      const json = await res.json();
      members = json?.data?.subscribers ?? 0;
    } catch {}
  }

  return { subreddit: sub, members, weekly_visitors, weekly_contributions };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const sub = url.searchParams.get('sub');

    if (!sub) {
      return new Response(JSON.stringify({ error: 'Missing ?sub= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stats = await fetchSubredditStats(sub);

    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

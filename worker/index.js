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
 */
async function fetchRedditPage(sub) {
  const pageUrl = `https://www.reddit.com/r/${sub}/`;

  // Step 1: Hit the page, get the challenge + cookies
  const challengeRes = await fetch(pageUrl, { headers: BROWSER_HEADERS, redirect: 'follow' });
  const challengeHtml = await challengeRes.text();

  if (!challengeHtml.includes('Please wait for verification')) {
    return challengeHtml; // No challenge, lucky
  }

  // Use the final URL after any redirects (e.g. /r/Cline/ → /r/CLine/)
  // The challenge cookies and token are bound to the canonical URL
  const canonicalUrl = challengeRes.url || pageUrl;

  // Extract the challenge input
  const challengeMatch = challengeHtml.match(/\("([0-9a-f]+)"\)/);
  if (!challengeMatch) return challengeHtml;

  const input = challengeMatch[1];
  const solution = input + input; // (async e => e+e) pattern

  // Collect cookies from the challenge response
  const cookies = challengeRes.headers.getAll('set-cookie')
    .map(c => c.split(';')[0])
    .join('; ');

  // Step 2: Submit solution with cookies and Referer using the canonical URL
  const solvedRes = await fetch(`${canonicalUrl}?solution=${solution}`, {
    headers: {
      ...BROWSER_HEADERS,
      'Referer': canonicalUrl,
      'Cookie': cookies,
    },
    redirect: 'follow',
  });

  return await solvedRes.text();
}

async function fetchSubredditStats(sub) {
  let members = 0, weekly_visitors = 0, weekly_contributions = 0;

  // Strategy 1: Fetch page HTML (solving challenge) for weekly stats
  try {
    const html = await fetchRedditPage(sub);
    const stats = parseHeaderTag(html);
    if (stats) {
      weekly_visitors = stats.weekly_visitors;
      weekly_contributions = stats.weekly_contributions;
    }
  } catch {}

  // Strategy 2: about.json for subscribers
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/about.json`, {
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
    });
    const json = await res.json();
    members = json?.data?.subscribers ?? 0;
  } catch {}

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
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  },
};

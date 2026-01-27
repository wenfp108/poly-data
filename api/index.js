const axios = require('axios');

export default async function handler(req, res) {
  try {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME, CRON_SECRET } = process.env;

    // 🔒 1. 安全门神 (520laowen)
    if (req.query.key !== CRON_SECRET) {
      return res.status(401).json({ error: '⛔ Unauthorized' });
    }

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    // === 📅 2. 你的核心提问策略 (完全恢复) ===
    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currDay = now.getDate();
    const currMonthIdx = now.getMonth();
    const currYear = now.getFullYear();

    let targetMonths = [months[currMonthIdx]];
    if (currDay >= 15) {
        const nextMonthIdx = (currMonthIdx + 1) % 12;
        targetMonths.push(months[nextMonthIdx]);
    }

    let targetYears = [String(currYear)];
    if (currMonthIdx >= 9) { 
        targetYears.push(String(currYear + 1));
    }

    const getFmtDate = (dateObj) => `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
    const t0 = new Date(now);
    const t1 = new Date(now.getTime() + 86400000);
    const t2 = new Date(now.getTime() + 172800000);
    const targetDates = [getFmtDate(t0), getFmtDate(t1), getFmtDate(t2)];

    let searchQueries = [];
    targetMonths.forEach(m => {
        searchQueries.push(`What will Gold (GC) settle at in ${m}?`);
        searchQueries.push(`What will Gold (GC) hit__ by end of ${m}?`);
        searchQueries.push(`Fed decision in ${m}?`);
        searchQueries.push(`What price will Bitcoin hit in ${m}?`);
    });
    targetYears.forEach(y => {
        searchQueries.push(`How many Fed rate cuts in ${y}?`);
    });
    searchQueries.push(`Bitcoin all time high by ___?`);
    targetDates.forEach(d => {
        searchQueries.push(`Bitcoin price on ${d}?`);
        searchQueries.push(`Bitcoin above ___ on ${d}?`);
    });

    // ===========================================

    let scoutedSlugs = new Set();
    let debugLog = [];
    debugLog.push(`Task Start: Generated ${searchQueries.length} queries`);

    // 🚀 3. 核心搜索：使用官方搜索代理接口 (避开 DNS 坑，确保精度)
    for (const q of searchQueries) {
      try {
        // 【关键】这里用的是 public-search，它在后台调用 Algolia 但走的是官方域名
        const searchUrl = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}`;
        const searchResp = await axios.get(searchUrl, { headers, timeout: 5000 });
        
        if (searchResp.data && searchResp.data.length > 0) {
          const bestMatch = searchResp.data[0];
          if (bestMatch.slug) {
              scoutedSlugs.add(bestMatch.slug);
              debugLog.push(`[OK] "${q}" -> ${bestMatch.slug}`);
          }
        } else {
          debugLog.push(`[EMPTY] "${q}"`);
        }
      } catch (err) {
        debugLog.push(`[SEARCH ERR] "${q}": ${err.message}`);
      }
    }

    // 🚀 4. 数据提取 (恢复你的完整过滤和解析逻辑)
    let processedData = [];
    for (const slug of Array.from(scoutedSlugs)) {
      try {
        const eventResp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, { headers, timeout: 5000 });
        const event = eventResp.data[0];
        if (!event || !event.markets) continue;

        event.markets.forEach(m => {
            if (!m.active || m.closed) return;
            const vol = Number(m.volume || 0);
            const liq = Number(m.liquidity || 0);
            if (vol < 100 && liq < 100) return; 

            let prices = [], outcomes = [];
            try {
                prices = JSON.parse(m.outcomePrices) || [];
                outcomes = JSON.parse(m.outcomes) || [];
            } catch (e) { return; }

            let priceStr = outcomes.map((o, i) => {
                const pVal = (Number(prices[i]) * 100).toFixed(1);
                return `${o}: ${pVal}%`;
            }).join(" | ");

            processedData.push({
                slug: slug,
                ticker: m.slug,
                question: m.groupItemTitle || m.question,
                eventTitle: event.title,
                prices: priceStr,
                volume: Math.round(vol),
                liquidity: Math.round(liq),
                endDate: m.endDate ? m.endDate.split("T")[0] : "N/A"
            });
        });
      } catch (e) {
          debugLog.push(`[FETCH ERR] ${slug}: ${e.message}`);
      }
    }

    processedData.sort((a, b) => b.volume - a.volume);

    // 🚀 5. GitHub 存档
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0];
    const timePart = isoString.split('T')[1].split('.')[0].replace(/:/g, '-');
    const fileName = `Finance_LIVE_${datePart}_${timePart}.json`;
    const path = `data/strategy/${datePart}/${fileName}`;
    const contentPayload = processedData.length > 0 ? processedData : [{ info: "No data found", debug: debugLog }];

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: `Strategy Sync: ${fileName}`,
      content: Buffer.from(JSON.stringify(contentPayload, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ Done! Found ${processedData.length} items.`);
  } catch (err) {
    res.status(500).send(`❌ Global Error: ${err.message}`);
  }
}

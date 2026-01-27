const axios = require('axios');

export default async function handler(req, res) {
  try {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME, CRON_SECRET } = process.env;

    // 🔒 1. 安全门神 (保持不变)
    if (req.query.key !== CRON_SECRET) {
      return res.status(401).json({ error: '⛔ Unauthorized' });
    }

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    // === 📅 2. 智能时间逻辑 (保持不变，下划线逻辑不动) ===
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
    const t2 = new Date(now.getTime() + 86400000 * 2);
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

    // 🚀 第一阶段：搜索 (Scouting) - 【此处已修改为 Algolia 高精度方案】
    // 这是官网搜索框的真实接口，专门用来把问题转换成 slug
    const algoliaUrl = "https://p6o7n0849h-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.20.0)";
    const algoliaHeaders = {
      'x-algolia-api-key': '0699042c3ef3ef3083163683a3f3607f',
      'x-algolia-application-id': 'P6O7N0849H'
    };

    for (const q of searchQueries) {
      try {
        const algoliaBody = {
          "requests": [{
            "indexName": "polymarket_events_production",
            "params": `query=${encodeURIComponent(q)}&hitsPerPage=1` // 精准锁定第1个结果
          }]
        };

        const algoliaResp = await axios.post(algoliaUrl, algoliaBody, { headers: algoliaHeaders });
        const hit = algoliaResp.data.results[0].hits[0];

        if (hit && hit.slug) {
          scoutedSlugs.add(hit.slug);
          debugLog.push(`Query [${q}] -> Found Slug: ${hit.slug}`);
        } else {
          debugLog.push(`Query [${q}] -> No match found`);
        }
      } catch (err) {
        console.error(`Algolia error for query [${q}]:`, err.message);
      }
    }

    // 🚀 第二阶段：提取 (Fetching) - (保持不变，现在它能拿到真正的 slug 了)
    let processedData = [];

    for (const slug of scoutedSlugs) {
      try {
        const eventResp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, { headers });
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
          console.error(`Error fetching slug ${slug}:`, e.message);
      }
    }

    processedData.sort((a, b) => b.volume - a.volume);

    // 🚀 第三阶段：GitHub 存档 (保持不变)
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0];
    const timePart = isoString.split('T')[1].split('.')[0].replace(/:/g, '-');
    const fileName = `Finance_LIVE_${datePart}_${timePart}.json`;
    const path = `data/strategy/${datePart}/${fileName}`;
    const contentPayload = processedData.length > 0 ? processedData : [{ info: "No active markets found", debug: debugLog }];

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: `woon-poly-datav1: ${fileName}`,
      content: Buffer.from(JSON.stringify(contentPayload, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ 运行成功！发现 ${processedData.length} 条有效数据。`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`❌ Error: ${err.message}`);
  }
}

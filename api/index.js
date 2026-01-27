const axios = require('axios');

export default async function handler(req, res) {
  try {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME, CRON_SECRET } = process.env;

    // 🔒 1. 安全校验
    if (req.query.key !== CRON_SECRET) {
      return res.status(401).json({ error: '⛔ Unauthorized' });
    }

    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://polymarket.com/'
    };

    // === 📅 2. 你的智能时间逻辑 (完整还原) ===
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

    // === 🔍 3. 指令生成器 (你的核心策略：全部找回) ===
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

    // 🚀 4. 增强版搜索逻辑 (Algolia + Gamma Search 双保险)
    const APP_ID = "p6o7n0849h"; // 强制小写
    const API_KEY = "0699042c3ef3ef3083163683a3f3607f";
    
    // 重新排列域名顺序，优先使用最稳定的非 DSN 域名
    const algoliaHosts = [
      `https://${APP_ID}.algolia.net`,
      `https://${APP_ID}-1.algolianet.com`,
      `https://${APP_ID}-dsn.algolia.net`
    ];

    for (const q of searchQueries) {
      let querySuccess = false;

      // --- 尝试 Algolia 路径 ---
      for (const host of algoliaHosts) {
        if (querySuccess) break;
        try {
          const algoliaUrl = `${host}/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.20.0)`;
          const algoliaResp = await axios.post(algoliaUrl, {
            "requests": [{ "indexName": "polymarket_events_production", "params": `query=${encodeURIComponent(q)}&hitsPerPage=1` }]
          }, { headers: { 'x-algolia-api-key': API_KEY, 'x-algolia-application-id': APP_ID }, timeout: 2500 });

          const hit = algoliaResp.data.results[0].hits[0];
          if (hit && hit.slug) {
            scoutedSlugs.add(hit.slug);
            debugLog.push(`[ALGOLIA OK] "${q}" -> ${hit.slug}`);
            querySuccess = true;
          }
        } catch (err) { continue; }
      }

      // --- 备选路径：如果 Algolia 全部失败，使用官网公共搜索接口 (准确率也很高) ---
      if (!querySuccess) {
        try {
          const fallbackUrl = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}`;
          const fbResp = await axios.get(fallbackUrl, { headers, timeout: 3000 });
          if (fbResp.data && fbResp.data.length > 0) {
            const fbSlug = fbResp.data[0].slug;
            scoutedSlugs.add(fbSlug);
            debugLog.push(`[FALLBACK OK] "${q}" -> ${fbSlug}`);
            querySuccess = true;
          }
        } catch (err) {
          debugLog.push(`[ALL FAIL] "${q}": ${err.message}`);
        }
      }
    }

    // 🚀 5. 第二阶段：提取数据 (原样还原你的完整提取逻辑)
    let processedData = [];
    for (const slug of scoutedSlugs) {
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
          debugLog.push(`[FETCH ERROR] ${slug}: ${e.message}`);
      }
    }

    processedData.sort((a, b) => b.volume - a.volume);

    // 🚀 6. 第三阶段：GitHub 存档 (保持不变)
    const isoString = now.toISOString();
    const datePart = isoString.split('T')[0];
    const timePart = isoString.split('T')[1].split('.')[0].replace(/:/g, '-');
    const fileName = `Finance_LIVE_${datePart}_${timePart}.json`;
    const path = `data/strategy/${datePart}/${fileName}`;
    const contentPayload = processedData.length > 0 ? processedData : [{ info: "No active markets found", debug: debugLog }];

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      message: `Strategy Sync: ${fileName}`,
      content: Buffer.from(JSON.stringify(contentPayload, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });

    res.status(200).send(`✅ 运行成功！处理了 ${searchQueries.length} 个词，找到 ${processedData.length} 条数据。`);
  } catch (err) {
    res.status(500).send(`❌ 全局错误: ${err.message}`);
  }
}

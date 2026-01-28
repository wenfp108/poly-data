const puppeteer = require('puppeteer');
const axios = require('axios');
const http = require('http');

// === 🛠️ 1. 从 GitHub Issues 获取配置 (你的新前端) ===
async function fetchQuestionsFromIssues() {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME } = process.env;
    // 获取该仓库所有状态为 "open" 的 issues
    const issuesUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&per_page=100`;

    try {
        console.log("📥 Reading questions from GitHub Issues...");
        const resp = await axios.get(issuesUrl, {
            headers: { 
                Authorization: `Bearer ${GITHUB_TOKEN}`, 
                Accept: 'application/vnd.github.v3+json' 
            }
        });
        
        // 提取所有 Issue 的标题
        const questions = resp.data.map(issue => issue.title);
        console.log(`✅ Loaded ${questions.length} active questions from Issues.`);
        return questions;
    } catch (e) {
        console.error("❌ Failed to fetch issues:", e.message);
        return [];
    }
}

// === 📅 2. 智能问题生成器 (支持 {month} 占位符) ===
async function generateQueries() {
    // 1. 从 Issue 获取原始标题
    const rawTemplates = await fetchQuestionsFromIssues();
    
    // 如果没有 Issue，为了防止报错，我们给几个默认的保底问题
    if (rawTemplates.length === 0) {
        console.log("⚠️ No active Issues found. Using default fallback.");
        return [`What will Gold (GC) settle at in {month}?`]; 
    }

    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currMonth = months[now.getMonth()];
    const nextMonth = months[(now.getMonth() + 1) % 12];
    const currYear = String(now.getFullYear());
    const currDateStr = `${currMonth} ${now.getDate()}`; 

    let finalQueries = [];

    rawTemplates.forEach(template => {
        // 如果标题里包含动态占位符，进行替换
        if (template.includes("{month}") || template.includes("{year}") || template.includes("{date}")) {
            // 生成“当月”版本
            let q1 = template.replace(/{month}/g, currMonth)
                             .replace(/{next_month}/g, nextMonth)
                             .replace(/{year}/g, currYear)
                             .replace(/{date}/g, currDateStr);
            finalQueries.push(q1);

            // 如果包含 {month}，通常顺便查一下“下个月”，防止遗漏
            if (template.includes("{month}")) {
                let q2 = template.replace(/{month}/g, nextMonth)
                                 .replace(/{next_month}/g, months[(now.getMonth() + 2) % 12])
                                 .replace(/{year}/g, currYear)
                                 .replace(/{date}/g, currDateStr);
                finalQueries.push(q2);
            }
        } else {
            // 固定问题
            finalQueries.push(template);
        }
    });

    return [...new Set(finalQueries)]; // 去重
}

// === 🔍 3. 模拟搜索 (已修复 "live" bug) ===
async function getSlugs() {
    const queries = await generateQueries();
    const slugs = new Set();
    
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const q of queries) {
        try {
            console.log(`[SCOUTING] ${q}`);
            await page.goto(`https://polymarket.com/search?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle2', timeout: 25000 });
            
            // 🔥 核心修复逻辑在此 🔥
            const slug = await page.evaluate(() => {
                // 1. 找到所有看起来像事件链接的 a 标签
                const links = Array.from(document.querySelectorAll('a[href^="/event/"]'));
                
                // 2. 遍历链接，找到第一个不是 "live" 也不是 "news" 的真正 slug
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const parts = href.split('/');
                    const potentialSlug = parts.pop() || parts.pop(); // 防止末尾斜杠
                    
                    // 黑名单过滤：排除干扰项
                    if (potentialSlug !== 'live' && potentialSlug !== 'news' && potentialSlug !== 'activity') {
                        return potentialSlug; // 找到正主，立即返回
                    }
                }
                return null;
            });

            if (slug) {
                slugs.add(slug);
                console.log(`[MATCH] ✅ Found Real Slug: ${slug}`);
            } else {
                console.log(`[FAIL] ❌ No valid slug found for: ${q}`);
            }
        } catch (e) { console.log(`[SKIP] ${q}`); }
    }
    await browser.close();
    return Array.from(slugs);
}

// === 🚀 4. 数据同步 (逻辑不变) ===
async function syncData() {
    const { GITHUB_TOKEN, REPO_OWNER, REPO_NAME } = process.env;
    if (!GITHUB_TOKEN) return console.log("❌ Missing Secrets!");

    const slugs = await getSlugs();
    let processedData = [];

    for (const slug of slugs) {
        try {
            const resp = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
            const event = resp.data[0];
            if (!event || !event.markets) continue;

            event.markets.forEach(m => {
                if (!m.active || m.closed || m.archived) return;
                
                const totalVol = Number(m.volume || 0);
                const liq = Number(m.liquidity || 0);
                // 门槛稍微放低一点，防止新 Issue 刚提出来没量被过滤
                if (totalVol < 10 && liq < 10) return; 

                let prices = [], outcomes = [];
                try {
                    prices = JSON.parse(m.outcomePrices);
                    outcomes = JSON.parse(m.outcomes);
                } catch (e) { return; }

                let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");

                processedData.push({
                    slug: slug,
                    ticker: m.slug,
                    question: m.groupItemTitle || m.question,
                    eventTitle: event.title,
                    prices: priceStr,
                    volume: Math.round(totalVol),
                    liquidity: Math.round(liq),
                    endDate: m.endDate ? m.endDate.split("T")[0] : "N/A",
                    dayChange: m.oneDayPriceChange ? (m.oneDayPriceChange * 100).toFixed(2) + "%" : "0.00%",
                    vol24h: Math.round(Number(m.volume24hr || 0)),
                    spread: m.spread ? (m.spread * 100).toFixed(2) + "%" : "N/A",
                    sortOrder: Number(m.groupItemThreshold || 0),
                    updatedAt: m.updatedAt
                });
            });
        } catch (e) { console.error(`Fetch Err: ${slug}`); }
    }

    if (processedData.length === 0) return console.log("No valid data found.");

    // 按成交量排序
    processedData.sort((a, b) => b.volume - a.volume);

    const now = new Date();
    
    // 1. 获取时间组件
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;

    // 2. 修改文件名格式: sniper-2026-1-28-15_30.json
    const fileName = `sniper-${year}-${month}-${day}-${timePart}.json`;

    // 3. 保持文件夹路径不变: data/strategy/2026-01-28/...
    const datePart = now.toISOString().split('T')[0];
    const path = `data/strategy/${datePart}/${fileName}`;

    await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
        message: `Sync from Issues: ${fileName}`,
        content: Buffer.from(JSON.stringify(processedData, null, 2)).toString('base64')
    }, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });
    
    console.log(`✅ Success: Archived ${processedData.length} items from GitHub Issues.`);
}

http.createServer(async (req, res) => {
    if (req.url === '/run') {
        console.log("🚀 Triggered by Action");
        syncData().then(() => console.log("Sync Complete")).catch(e => console.error(e));
        res.end("Run Started");
    } else {
        res.end("Monitor Agent Online");
    }
}).listen(7860);

const { DOMParser } = require('xmldom');
const xpath = require('xpath');

async function get_google_news_rss(search_term, count) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(search_term)}`;

  console.log('google news search url = ', url);

  const response = await fetch(url);
  const xmlText = await response.text();

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const select = xpath.useNamespaces({});

  const items = select('//item', doc);

  const news = items.map((item) => {
    const title = select('string(title)', item);
    const link = select('string(link)', item);
    const pubDateStr = select('string(pubDate)', item);
    const pubDate = new Date(pubDateStr);
    return { title, pubDate, link };
  });

  news.sort((a, b) => b.pubDate - a.pubDate);

  return news.slice(0, count).map(article => [
    article.title,
    article.pubDate, // modified date as necessary in the create slack msg function
    article.link
  ]);
}

// async function test(search_term, count) {
//     let results = await get_google_news_rss(search_term, count);
//     console.log(results);

//     process.exit(1);
// }

// test("Vail Resorts", 5);

module.exports = {
    get_google_news_rss,
}
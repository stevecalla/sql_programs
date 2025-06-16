function formatDate(date) {
  function pad(n) { return n < 10 ? '0' + n : n; }

  const daysOfWeek = ['Sun', 'Mon', 'Tues', 'Wed', 'Thur', 'Fri', 'Sat'];
  const dayOfWeek = daysOfWeek[date.getDay()];

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${dayOfWeek}, ${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function get_google_news_rss(symbol, count) {
  var url = `https://news.google.com/rss/search?q=${encodeURIComponent(symbol)}`;
  var response = UrlFetchApp.fetch(url);
  var xml = response.getContentText();
  var document = XmlService.parse(xml);
  var root = document.getRootElement();
  var channel = root.getChild('channel');
  var items = channel.getChildren('item');

  var news = [];

  for  (var i = 0; i < items.length; i++) {
    var item = items[i];
    var title = item.getChildText('title');
    var link = item.getChildText('link');
    var pubDateStr = item.getChildText('pubDate');
    var pubDate = new Date(pubDateStr);
    // pubDate = formatDate(pubDate);

    news.push({ title, pubDate, link });
  }

  // Sort by pubDate descending
  news.sort(function(a, b) {
    return b.pubDate - a.pubDate;
  });

  // Return top 15 most recent with formatted date
  return news.slice(0, count).map(function(article) {
    return [article.title, formatDate(article.pubDate), article.link];
  });
}

// let results = getGoogleNewsRSS("Vail Resorts", 10);
// console.log(results);

module.exports = {
    get_google_news_rss,
}
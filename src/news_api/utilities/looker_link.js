// CREATE URL LINKS
const TinyURL = require('tinyurl');

// NOTE: Added tinyurl b/c the google link was too long & slack rejected due to too many characters

async function looker_link(link, text) {
  const linkText = text || 'No Title Available';

  try {
    const shortUrl = await TinyURL.shorten(link);
    return `<${shortUrl}|${linkText}>`;
  } catch (error) {
    console.error('TinyURL shortening failed:', error.message);
    return `<${link}|${linkText}>`;
  }
}

module.exports = {
    looker_link,
}
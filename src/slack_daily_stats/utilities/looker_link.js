// CREATE LOOKER STUDIO LINKS
async function looker_link(link) {

  const link_dashboard = link;
  
  const formatted_link = `<${link_dashboard}|Link to Goals Dashboard>`;

  return formatted_link;
}

module.exports = {
    looker_link,
}


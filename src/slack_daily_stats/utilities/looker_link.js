// CREATE LOOKER STUDIO LINKS
async function looker_link(link, looker_dashboard) {

  const link_dashboard = link;
  const link_message = looker_dashboard ? `Link to ${looker_dashboard} Dasbhoard` : `Link to Goals Dashboard`;
  
  const formatted_link = `<${link_dashboard}|${link_message}>`;

  return formatted_link;
}

module.exports = {
    looker_link,
}


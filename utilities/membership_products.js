const type_map = ["adult_annual", "one_day", "elite", "youth_annual"];

const category_map = {
    // one_day / bronze
    bronze: ["Bronze - $0", "Bronze - AO", "Bronze - Distance Upgrade", "Bronze - Intermediate", "Bronze - Relay", "Bronze - Sprint", "Bronze - Ultra", "One Day - $15"],

    //annual
    silver: ["1-Year $50", "Silver"],
    gold: ["Gold"],
    two: ["2-Year"],
    three: ["3-Year"],
    lifetime: ["Lifetime"],
    elite: ["Elite"],
    youth_annual: ["Youth Annual"],
    foundation: ["Platinum - Foundation"],
    team_usa: ["Platinum - Team USA"],

    // young adult
    young_adult: ["Young Adult - $36", "Young Adult - $40", "Youth Premier - $25", "Youth Premier - $30"],
    
    // other
    club: ["Club"],
    other: ["Unknown"],
};

module.exports = {
    type_map,
    category_map,
}


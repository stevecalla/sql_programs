async function get_random_number(list_length) {
    // Generate a random index between 0 and url_list.length - 1
    const random_index = Math.floor(Math.random() * list_length);

    return (random_index);
}

async function get_random_image_from_api(url, key) {
    const response = await fetch(url);

    const data = await response.json();
    const image_url = data[key];
    // console.log(image_url);

    return image_url;
}

async function get_image_url() {
    const random_fox_url = await get_random_image_from_api("https://randomfox.ca/floof/", "image");

    const url_list = [
        "https://cataas.com/cat?type=square&position=center",
        "https://placedog.net/300?random",
        "https://picsum.photos/300",
        random_fox_url,
    ];
    // console.log(url_list);

    const random_number = await get_random_number(url_list.length);
    // console.log(random_number);

    const url = url_list[random_number];
    // console.log('random cat or dog url = ', url);

    // Return the randomly selected URL
    return url;
}

// const test = await get_image_url();
// console.log(test);

module.exports = {
    get_image_url,
}
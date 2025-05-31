// VARIABLES & MAP SETUP
// =======================
const centers = {
    Frisco: [33.1507, -96.8236],
    Dallas: [32.7791, -96.8003],
    Fort_Worth: [32.7555, -97.3308],
};

const radiusCache = {}; // if called more than once use cache to avoid recomputing the same geojson circle repeatedly

let clusteringEnabled = true;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [-97.0, 33.0],
    zoom: 8,
});

// EVENT LISTENERS
// =======================
const toggleCluster = debounce(async () => {
    await show_spinner();
    clusteringEnabled = !clusteringEnabled;
    try {
        await add_customer_layers(clusteringEnabled);
        modify_legend_content();

        // Wait for map to finish rendering before hiding spinner
        map.once('idle', () => {
            hide_spinner();
        });

    } catch (err) {
        console.error('Error toggling clustering:', err);
    }
}, 1000); // 1000ms debounce delay

// document.getElementById('toggle-cluster').addEventListener('click', toggleCluster);
document.getElementById('toggle-cluster').addEventListener('change', toggleCluster);

// FUNCTIONS
// =======================
async function fetch_geo_data() {
    try {
        const res = await fetch('/data/customer_map_no_clusters.geojson');
        return await res.json();
    } catch (err) {
        console.error('Error fetching geo data:', err);
    }
}

async function create_geo_json_circle(center, radiusInKm, points = 64) {
    const [lng, lat] = center;
    const distanceX = radiusInKm / (111.320 * Math.cos(lat * Math.PI / 180));
    const distanceY = radiusInKm / 110.574;

    const coordinates = Array.from({ length: points }, (_, i) => {
        const angle = (i / points) * (2 * Math.PI);
        return [lng + distanceX * Math.cos(angle), lat + distanceY * Math.sin(angle)];
    });
    coordinates.push(coordinates[0]);

    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            }
        }]
    };
}

async function add_radius_circles() {
    for (const [name, coords] of Object.entries(centers)) {
        const [lat, lng] = coords;

        new mapboxgl.Marker({ color: 'blue' })
            .setLngLat([lng, lat])
            .setPopup(new mapboxgl.Popup().setText(`${name} Center`))
            .addTo(map);

        if (!radiusCache[name]) {
            radiusCache[name] = await create_geo_json_circle([lng, lat], 64.37);
        }

        map.addSource(`${name}-circle`, { type: 'geojson', data: radiusCache[name] });

        map.addLayer({
            id: `${name}-circle-layer`,
            type: 'fill',
            source: `${name}-circle`,
            paint: {
                'fill-color': '#0000ff',
                'fill-opacity': 0.1
            }
        });
    }
}

async function add_customer_layers(clustered) {
    safelyRemoveLayerAndSource('customers', ['clusters', 'cluster-count', 'unclustered-point']);

    map.addSource('customers', {
        type: 'geojson',
        data: '/data/customer_map_no_clusters.geojson',
        cluster: clustered,
        clusterMaxZoom: 14,
        clusterRadius: 50
    });

    if (clustered) {
        map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'customers',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': [
                    'step', ['get', 'point_count'],
                    '#00cc44', 25,
                    '#ff6600', 100,
                    '#0066ff', 500,
                    '#cc0000'
                ],
                'circle-radius': [
                    'step', ['get', 'point_count'],
                    15, 25,
                    20, 100,
                    25, 500,
                    30
                ],
                'circle-opacity': 0.6
            }
        });

        map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'customers',
            filter: ['has', 'point_count'],
            layout: {
                'text-field': '{point_count_abbreviated}',
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 12
            }
        });
    }

    map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'customers',
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': [
                'match',
                ['get', 'radius_tag'],
                'inside_frisco', '#00cc44',
                'inside_dallas', '#ff6600',
                'inside_fort_worth', '#0066ff',
                'outside', '#999999',
                '#000000'
            ],
            'circle-radius': 4,
            'circle-opacity': 0.7
        }
    });

    map.on('click', 'unclustered-point', (e) => {
    const props = e.features[0].properties;
    new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
            <strong>${props.id_profiles}</strong><br>
            Memberships: ${props.membership_periods}<br>
            Status: ${props.radius_tag}
        `)
        .addTo(map);
});

}

function safelyRemoveLayerAndSource(sourceId, layerIds = []) {
    layerIds.forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(sourceId)) map.removeSource(sourceId);
}

function modify_legend_content() {
    const legend = document.getElementById('legend-content');
    legend.innerHTML = clusteringEnabled
        ? `
            <div><span class="legend-color" style="background:#00cc44;"></span>Small Cluster (≤25)</div>
            <div><span class="legend-color" style="background:#ff6600;"></span>Medium Cluster (26–100)</div>
            <div><span class="legend-color" style="background:#0066ff;"></span>Large Cluster (101–500)</div>
            <div><span class="legend-color" style="background:#cc0000;"></span>Very Large Cluster (&gt;500)</div>
        `
        : `
            <div><span class="legend-color" style="background:#00cc44;"></span>Inside Frisco</div>
            <div><span class="legend-color" style="background:#ff6600;"></span>Inside Dallas</div>
            <div><span class="legend-color" style="background:#0066ff;"></span>Inside Fort Worth</div>
            <div><span class="legend-color" style="background:#999999;"></span>Outside 40mi Radius</div>
        `;
}

// UTILITY FUNCTIONS
// =======================
async function show_spinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'flex';
}

function hide_spinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'none';
}

function debounce(func, delay) {
    let timeout;
    return function (...args) {
        if (timeout) return; // Block repeated clicks
        func.apply(this, args);
        timeout = setTimeout(() => {
            timeout = null;
        }, delay);
    };
}

// MAP CONTROLS
// =======================
map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-right');

// map.addControl(new mapboxgl.FullscreenControl(), 'top-right');
map.addControl(new mapboxgl.FullscreenControl({ container: document.getElementById('map-container') }), 'top-right');

const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl: mapboxgl,
    countries: 'us',
    placeholder: 'Search US ZIP code or city',
    types: 'postcode,place',
    marker: false,
    zoom: 11
});
map.addControl(geocoder, 'top-left');

geocoder.on('result', (e) => {
    map.flyTo({ center: e.result.center, zoom: 11 });
});

// INITIALIZE MAP
// =======================
map.on('load', async () => {
    // show_spinner();
    try {
        await fetch_geo_data();              // Load once if needed later
        await add_radius_circles();          // Add city markers + 40mi radius
        await add_customer_layers(clusteringEnabled); // Load customer data
        
        // Wait for map to become idle (all tiles/layers rendered)

        map.once('idle', hide_spinner); // <- clean

    } catch (err) {
        console.error('Error loading map data:', err);
        hide_spinner(); // fallback in case 'idle' isn't triggered
    }
});


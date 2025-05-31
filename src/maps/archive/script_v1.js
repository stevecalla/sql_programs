document.addEventListener('DOMContentLoaded', () => {
  mapboxgl.accessToken = 'YOUR_MAPBOX_ACCESS_TOKEN';

  const centers = {
    Frisco: [33.1507, -96.8236],
    Plano: [33.0198, -96.6989],
    // Add more if needed
  };

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [-97.0, 33.0],
    zoom: 8
  });

  map.on('load', () => {
    // 1. Add customer points
    fetch('/data/customer_map_no_clusters.geojson')
      .then(res => res.json())
      .then(data => {
        map.addSource('customers', {
          type: 'geojson',
          data: data
        });

        map.addLayer({
          id: 'customer-points',
          type: 'circle',
          source: 'customers',
          paint: {
            'circle-radius': 4,
            'circle-color': '#00cc44',
            'circle-opacity': 0.7
          }
        });

        map.on('click', 'customer-points', (e) => {
          const props = e.features[0].properties;
          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${props.id_profiles}</strong><br>Memberships: ${props.membership_periods}`)
            .addTo(map);
        });
      });

    // 2. Add center points and radius circles
    for (const [name, coords] of Object.entries(centers)) {
      // Add marker
      new mapboxgl.Marker({ color: 'blue' })
        .setLngLat([coords[1], coords[0]]) // lng, lat
        .setPopup(new mapboxgl.Popup().setText(`${name} Center`))
        .addTo(map);

      // Add 40-mile radius circle (approx. 64.37 km)
      const radiusInKm = 64.37;
      const circleGeoJSON = createGeoJSONCircle([coords[1], coords[0]], radiusInKm, 64);

      map.addSource(`${name}-circle`, {
        type: 'geojson',
        data: circleGeoJSON
      });

      map.addLayer({
        id: `${name}-circle-layer`,
        type: 'fill',
        source: `${name}-circle`,
        layout: {},
        paint: {
          'fill-color': '#0000ff',
          'fill-opacity': 0.1
        }
      });
    }
  });

  // Function to generate a circular polygon
  function createGeoJSONCircle(center, radiusInKm, points) {
    const coords = {
      latitude: center[1],
      longitude: center[0]
    };
    const km = radiusInKm;

    const ret = [];
    const distanceX = km / (111.320 * Math.cos(coords.latitude * Math.PI / 180));
    const distanceY = km / 110.574;

    for (let i = 0; i < points; i++) {
      const theta = (i / points) * (2 * Math.PI);
      const x = distanceX * Math.cos(theta);
      const y = distanceY * Math.sin(theta);

      ret.push([coords.longitude + x, coords.latitude + y]);
    }
    ret.push(ret[0]); // close the polygon

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [ret]
          }
        }
      ]
    };
  }
});

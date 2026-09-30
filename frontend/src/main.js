import './ducktown.css';
import './microduck-3d.css';
import './ducktown-polish.css';
import './ducktown.js';

// Keep the social UI responsive even when WebGL or the optional 3D bundle fails.
import('./microduck-3d.js').catch(error => console.warn('3D view unavailable; using the SVG illustration.', error));

import 'babel-polyfill';
import React from 'react';
import ReactDOM from 'react-dom';
import FastClick from 'fastclick';
import queryString from 'query-string';
import { createPath } from 'history/PathUtils';
import io from 'socket.io-client';
import { fromJS } from 'immutable';
import history from './core/history';
import App from './components/App';
import configureStore from './store/configureStore';
import { updateMeta } from './core/DOMUtils';
import { ErrorReporter, deepForceUpdate } from './core/devUtils';
import createEngineMiddleware from './middleware/client/engineMiddleware';
import createSocketIoMiddleware from './middleware/client/socketIoMiddleware';

/* eslint-disable global-require */

// Global (context) variables that can be easily accessed from any React component
// https://facebook.github.io/react/docs/context.html

const socket = io();
const clientID = window.APP_STATE && window.APP_STATE.runtime
  ? window.APP_STATE.runtime.clientID
  : null;

if (clientID) {
  // tell server which clientID the socket is associated with
  socket.emit('clientID', clientID);
}
socket.on('error', (err) => {
  if (err) {
    console.error('Socket error', err); // eslint-disable-line no-console
  } else {
    console.error('Socket error.'); // eslint-disable-line no-console
  }
});

const socketIoMiddleware = createSocketIoMiddleware(socket,
  (type, action) => (action.meta && (action.meta.cc === 'server')));

const engine = new Worker('chess/engines/lozza_patches.js');
const engineMiddleware = createEngineMiddleware(engine);

// Initialize a new Redux store
// http://redux.js.org/docs/basics/UsageWithReact.html
const store = configureStore(fromJS(window.APP_STATE),
  { history },
  [socketIoMiddleware, engineMiddleware]);

const context = {
  // Enables critical path CSS rendering
  // https://github.com/kriasoft/isomorphic-style-loader
  insertCss: (...styles) => {
    // eslint-disable-next-line no-underscore-dangle
    const removeCss = styles.map(x => x._insertCss());
    return () => { removeCss.forEach(f => f()); };
  },
  store,
};

// Switch off the native scroll restoration behavior and handle it manually
// https://developers.google.com/web/updates/2015/09/history-api-scroll-restoration
const scrollPositionsHistory = {};
if (window.history && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

let onRenderComplete = function initialRenderComplete() {
  const elem = document.getElementById('css');
  if (elem) elem.parentNode.removeChild(elem);
  onRenderComplete = function renderComplete(route, location) {
    document.title = route.title;

    updateMeta('description', route.description);
    // Update necessary tags in <head> at runtime here, ie:
    // updateMeta('keywords', route.keywords);
    // updateCustomMeta('og:url', route.canonicalUrl);
    // updateCustomMeta('og:image', route.imageUrl);
    // updateLink('canonical', route.canonicalUrl);
    // etc.

    let scrollX = 0;
    let scrollY = 0;
    const pos = scrollPositionsHistory[location.key];
    if (pos) {
      scrollX = pos.scrollX;
      scrollY = pos.scrollY;
    } else {
      const targetHash = location.hash.substr(1);
      if (targetHash) {
        const target = document.getElementById(targetHash);
        if (target) {
          scrollY = window.pageYOffset + target.getBoundingClientRect().top;
        }
      }
    }

    // Restore the scroll position if it was saved into the state
    // or scroll to the given #hash anchor
    // or scroll to top of the page
    window.scrollTo(scrollX, scrollY);

    // Google Analytics tracking. Don't send 'pageview' event after
    // the initial rendering, as it was already sent
    if (window.ga) {
      window.ga('send', 'pageview', createPath(location));
    }
  };
};

// Make taps on links and buttons work fast on mobiles
FastClick.attach(document.body);

const container = document.getElementById('app');
let appInstance;
let currentLocation = history.location;
let router = require('./core/router').default;

// Re-render the app when window.location changes
async function onLocationChange(location, action) {
  // Remember the latest scroll position for the previous location
  scrollPositionsHistory[currentLocation.key] = {
    scrollX: window.pageXOffset,
    scrollY: window.pageYOffset,
  };
  // Delete stored scroll position for next page if any
  if (action === 'PUSH') {
    delete scrollPositionsHistory[location.key];
  }
  currentLocation = location;

  try {
    // Traverses the list of routes in the order they are defined until
    // it finds the first route that matches provided URL path string
    // and whose action method returns anything other than `undefined`.
    const route = await router.resolve({
      ...context,
      path: location.pathname,
      query: queryString.parse(location.search),
    });

    // Prevent multiple page renders during the routing process
    if (currentLocation.key !== location.key) {
      return;
    }

    if (route.redirect) {
      history.replace(route.redirect);
      return;
    }

    appInstance = ReactDOM.render(
      <App context={context}>{route.component}</App>,
      container,
      () => onRenderComplete(route, location),
    );
  } catch (error) {
    // Display the error in full-screen for development mode
    if (__DEV__) {
      appInstance = null;
      document.title = `Error: ${error.message}`;
      ReactDOM.render(<ErrorReporter error={error} />, container);
      throw error;
    }

    console.error(error); // eslint-disable-line no-console

    // Do a full page reload if error occurs during client-side navigation
    if (action && currentLocation.key === location.key) {
      window.location.reload();
    }
  }
}

// Handle client-side navigation by using HTML5 History API
// For more information visit https://github.com/mjackson/history#readme
history.listen(onLocationChange);
onLocationChange(currentLocation);

// Handle errors that might happen after rendering
// Display the error in full-screen for development mode
if (__DEV__) {
  window.addEventListener('error', (event) => {
    appInstance = null;
    document.title = `Runtime Error: ${event.error.message}`;
    ReactDOM.render(<ErrorReporter error={event.error} />, container);
  });
}

// Enable Hot Module Replacement (HMR)
if (module.hot) {
  module.hot.accept('./core/router', () => {
    router = require('./core/router').default;

    if (appInstance) {
      try {
        // Force-update the whole tree, including components that refuse to update
        deepForceUpdate(appInstance);
      } catch (error) {
        appInstance = null;
        document.title = `Hot Update Error: ${error.message}`;
        ReactDOM.render(<ErrorReporter error={error} />, container);
        return;
      }
    }

    onLocationChange(currentLocation);
  });
}

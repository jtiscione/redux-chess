import 'babel-polyfill';
import ReactDOM from 'react-dom';
import FastClick from 'fastclick';
import UniversalRouter from 'universal-router';
import { readState, saveState } from 'history/lib/DOMStateStorage';
import routes from './routes';
import createHistory from './core/createHistory';
import createSocketIoMiddleware from 'redux-socket.io';
import io from 'socket.io-client';
import configureStore from './store/configureStore';
import { fromJS } from 'immutable';
import {
  addEventListener,
  removeEventListener,
  windowScrollX,
  windowScrollY,
} from './core/DOMUtils';

import {subscribeEngineToStore} from './subscribers/engineManager.js';

const context = {
  store: null,
  insertCss: (...styles) => {
    const removeCss = styles.map(style => style._insertCss()); // eslint-disable-line no-underscore-dangle, max-len
    return () => {
      removeCss.forEach(f => f());
    };
  },
  setTitle: value => (document.title = value),
  setMeta: (name, content) => {
    // Remove and create a new <meta /> tag in order to make it work
    // with bookmarks in Safari
    const elements = document.getElementsByTagName('meta');
    Array.from(elements).forEach((element) => {
      if (element.getAttribute('name') === name) {
        element.parentNode.removeChild(element);
      }
    });
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    meta.setAttribute('content', content);
    document
      .getElementsByTagName('head')[0]
      .appendChild(meta);
  },
};

// Restore the scroll position if it was saved into the state
function restoreScrollPosition({ state, hash }) {
  if (state && state.scrollY !== undefined) {
    window.scrollTo(state.scrollX, state.scrollY);
    return;
  }

  const targetHash = hash && hash.substr(1);
  if (targetHash) {
    const target = document.getElementById(targetHash);
    if (target) {
      window.scrollTo(0, windowScrollY() + target.getBoundingClientRect().top);
      return;
    }
  }

  window.scrollTo(0, 0);
}

let renderComplete = (location, callback) => {
  const elem = document.getElementById('css');
  if (elem) elem.parentNode.removeChild(elem);
  callback(true);
  renderComplete = (l) => {
    restoreScrollPosition(l);

    // Google Analytics tracking. Don't send 'pageview' event after
    // the initial rendering, as it was already sent
    if (window.ga) {
      window.ga('send', 'pageview');
    }

    callback(true);
  };
};

function render(container, location, component) {
  return new Promise((resolve, reject) => {
    try {
      ReactDOM.render(
        component,
        container,
        renderComplete.bind(undefined, location, resolve)
      );
    } catch (err) {
      reject(err);
    }
  });
}

function run() {
  const socket = io();
  const socketIoMiddleware = createSocketIoMiddleware(socket, (type, action) => true);

  const history = createHistory();
  const container = document.getElementById('app');
  const initialState = fromJS(JSON.parse(
    document
      .getElementById('source')
      .getAttribute('data-initial-state')
  ));
  let currentLocation = history.getCurrentLocation();

  // Make taps on links and buttons work fast on mobiles
  FastClick.attach(document.body);

  context.store = configureStore(initialState, { history }, socketIoMiddleware);
  context.createHref = history.createHref;

  socket.on('ping', data => {
    //console.log("socket on ping: " + JSON.stringify(data));
  });
  // socket.on('state', state => store.dispatch({
  //   type: 'SET_STATE',
  //   state
  // }));

  subscribeEngineToStore(context.store);

  context.createHref = history.createHref;

  // Re-render the app when window.location changes
  function onLocationChange(location) {
    // Save the page scroll position into the current location's state
    if (currentLocation.key) {
      saveState(currentLocation.key, {
        ...readState(currentLocation.key),
        scrollX: windowScrollX(),
        scrollY: windowScrollY(),
      });
    }
    currentLocation = location;

    UniversalRouter.resolve(routes, {
      path: location.pathname,
      query: location.query,
      state: location.state,
      context,
      render: render.bind(undefined, container, location),
    }).catch(err => console.error(err)); // eslint-disable-line no-console
  }

  // Add History API listener and trigger initial change
  const removeHistoryListener = history.listen(onLocationChange);
  history.replace(currentLocation);

  // https://developers.google.com/web/updates/2015/09/history-api-scroll-restoration
  let originalScrollRestoration;
  if (window.history && 'scrollRestoration' in window.history) {
    originalScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
  }

  // Prevent listeners collisions during history navigation
  addEventListener(window, 'pagehide', function onPageHide() {
    removeEventListener(window, 'pagehide', onPageHide);
    removeHistoryListener();
    if (originalScrollRestoration) {
      window.history.scrollRestoration = originalScrollRestoration;
      originalScrollRestoration = undefined;
    }
  });
}

// Run the application when both DOM is ready and page content is loaded
if (['complete', 'loaded', 'interactive'].includes(document.readyState) && document.body) {
  run();
} else {
  document.addEventListener('DOMContentLoaded', run, false);
}

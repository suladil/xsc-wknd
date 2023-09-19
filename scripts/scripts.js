import {
  sampleRUM,
  buildBlock,
  loadHeader,
  loadFooter,
  decorateButtons,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForLCP,
  loadBlocks,
  loadCSS,
  getMetadata,
  decorateBlock,
  loadBlock,
} from './lib-franklin.js';

const LCP_BLOCKS = []; // add your LCP blocks to the list

export function addVideo(element, href) {
  element.innerHTML = `<video loop muted playsInline>
    <source data-src="${href}" type="video/mp4" />
  </video>`;
  const video = element.querySelector('video');
  const source = element.querySelector('video > source');

  source.src = source.dataset.src;
  video.load();
  video.addEventListener('loadeddata', () => {
    video.setAttribute('autoplay', true);
    video.setAttribute('data-loaded', true);
    video.play();
  });
}

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildHeroBlock(main) {
  const h1 = main.querySelector('h1');
  const content = document.createElement('div');
  content.classList.add('hero-content');
  content.append(h1);

  const h2 = main.querySelector('h2');
  if (h2) {
    const seperator = document.createElement('span');
    seperator.classList.add('seperator');
    content.append(seperator);
    content.append(h2);
  }

  const picture = main.querySelector('picture');
  const video = document.createElement('div');
  const anchor = main.querySelector('a');

  if (!picture && main.querySelector('h1')) {
    main.querySelector('p > a').remove();
    addVideo(video, anchor.href);
    main.prepend(video.querySelector('video'));
  }
  // eslint-disable-next-line no-bitwise
  if (content && picture && (content.compareDocumentPosition(picture)
    & Node.DOCUMENT_POSITION_PRECEDING)) {
    const section = document.createElement('div');
    section.append(buildBlock('hero', { elems: [picture, content] }));
    main.prepend(section);
  } else if (content && video) {
    const section = document.createElement('div');
    section.append(buildBlock('hero', { elems: [main.querySelector('video'), content] }));
    main.prepend(section);
  }
}

/**
 * to add/remove a template, just add/remove it in the list below
 */
const TEMPLATE_LIST = [
  'adventures',
  'scroll',
];

/**
 * Run template specific decoration code.
 * @param {Element} main The container element
 */
async function decorateTemplates(main) {
  try {
    const template = getMetadata('template');
    const templates = TEMPLATE_LIST;
    if (templates.includes(template)) {
      const mod = await import(`../templates/${template}/${template}.js`);
      loadCSS(`${window.hlx.codeBasePath}/templates/${template}/${template}.css`);
      if (mod.default) {
        await mod.default(main);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    buildHeroBlock(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  // hopefully forward compatible button decoration
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
}

/**
 * Adds the favicon.
 * @param {string} href The favicon URL
 */
export function addFavIcon(href) {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = href;
  const existingLink = document.querySelector('head link[rel="icon"]');
  if (existingLink) {
    existingLink.parentElement.replaceChild(link, existingLink);
  } else {
    document.getElementsByTagName('head')[0].appendChild(link);
  }
}

const tabElementMap = {};

function calculateTabSectionCoordinate(main, lastTabBeginningIndex, targetTabSourceSection) {
  if (!tabElementMap[lastTabBeginningIndex]) {
    tabElementMap[lastTabBeginningIndex] = [];
  }
  tabElementMap[lastTabBeginningIndex].push(targetTabSourceSection);
}

function calculateTabSectionCoordinates(main) {
  let lastTabIndex = -1;
  let foldedTabsCounter = 0;
  const mainSections = [...main.childNodes];
  main
    .querySelectorAll('div.section[data-tab-title]')
    .forEach((section) => {
      const currentSectionIndex = mainSections.indexOf(section);

      if (lastTabIndex < 0 || (currentSectionIndex - foldedTabsCounter) !== lastTabIndex) {
        // we construct a new tabs component, at the currentSectionIndex
        lastTabIndex = currentSectionIndex;
        foldedTabsCounter = 0;
      }

      foldedTabsCounter += 2;
      calculateTabSectionCoordinate(main, lastTabIndex, section);
    });
}

async function autoBlockTabComponent(main, targetIndex, tabSections) {
  // the display none will prevent a major CLS penalty.
  // franklin will remove this once the blocks are loaded.
  const section = document.createElement('div');
  section.setAttribute('class', 'section');
  section.setAttribute('style', 'display:none');
  section.dataset.sectionStatus = 'loading';
  const tabsBlock = document.createElement('div');
  tabsBlock.setAttribute('class', 'tabs');

  const tabContentsWrapper = document.createElement('div');
  tabContentsWrapper.setAttribute('class', 'contents-wrapper');

  tabsBlock.appendChild(tabContentsWrapper);

  tabSections.forEach((tabSection) => {
    tabSection.classList.remove('section');
    tabSection.classList.add('contents');
    // remove display: none
    tabContentsWrapper.appendChild(tabSection);
    tabSection.style.display = null;
  });
  main.insertBefore(section, main.childNodes[targetIndex]);
  section.append(tabsBlock);
  decorateBlock(tabsBlock);
  await loadBlock(tabsBlock);
  // unset display none manually.
  // somehow in some race conditions it won't be picked up by lib-franklin.
  // CLS is not affected
  section.style.display = null;
}

function aggregateTabSectionsIntoComponents(main) {
  calculateTabSectionCoordinates(main);

  // when we aggregate tab sections into a tab autoblock, the index get's lower.
  // say we have 3 tabs starting at index 10, 12 and 14. and then 3 tabs at 18, 20 and 22.
  // when we fold the first 3 into 1, those will start at index 10. But the other 3 should now
  // start at 6 instead of 18 because 'removed' 2 sections.
  let sectionIndexDelta = 0;
  Object.keys(tabElementMap).map(async (tabComponentIndex) => {
    const tabSections = tabElementMap[tabComponentIndex];
    await autoBlockTabComponent(main, tabComponentIndex - sectionIndexDelta, tabSections);
    sectionIndexDelta = tabSections.length - 1;
  });
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateTemplates(main);
    decorateMain(main);
    aggregateTabSectionsIntoComponents(main);
    document.body.classList.add('appear');
    await waitForLCP(LCP_BLOCKS);
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadBlocks(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  addFavIcon(`${window.hlx.codeBasePath}/icons/favicon-32.png`);
  sampleRUM('lazy');
  sampleRUM.observe(main.querySelectorAll('div[data-block-name]'));
  sampleRUM.observe(main.querySelectorAll('picture > img'));
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

export async function fetchJson(href) {
  const url = new URL(href);
  try {
    const resp = await fetch(
      url,
      {
        headers: {
          'Content-Type': 'text/html',
        },
        method: 'get',
        credentials: 'include',
      },
    );
    const error = new Error({
      code: 500,
      message: 'login error',
    });
    if (resp.redirected) throw (error);

    return resp.json();
  } catch (error) {
    return error;
  }
}

export function addElement(type, attributes, values = {}) {
  const element = document.createElement(type);

  Object.keys(attributes).forEach((attribute) => {
    element.setAttribute(attribute, attributes[attribute]);
  });

  Object.keys(values).forEach((val) => {
    element[val] = values[val];
  });

  return element;
}

loadPage();

// document.querySelectorAll('meta').forEach((m) => {
//   const prop = m.getAttribute('property');
//   if(prop && prop.startsWith('urn:adobe')) {
//     m.setAttribute('content', `aem:${m.getAttribute('content')}`);
//   }
// })

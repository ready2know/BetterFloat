import { html } from 'common-tags';
import { CrimsonKimonoMapping, OverprintMapping, PhoenixMapping } from 'cs-tierlist';
import getSymbolFromCurrency from 'currency-symbol-map';
import Decimal from 'decimal.js';
import type { PlasmoCSConfig } from 'plasmo';
import type { Extension } from '~lib/@typings/ExtensionTypes';
import type { CSFloat, DopplerPhase, ItemCondition, ItemStyle } from '~lib/@typings/FloatTypes';
import {
	cacheCSFInventory,
	getCSFAllBuyOrders,
	getCSFCurrencyRate,
	getCSFHistoryGraph,
	getCSFPopupItem,
	getFirstCSFItem,
	getFirstCSFSimilarItem,
	getFirstHistorySale,
	getSpecificCSFInventoryItem,
	getSpecificCSFOffer,
} from '~lib/handlers/cache/csfloat_cache';
import { dynamicUIHandler, mountCSFBargainButtons } from '~lib/handlers/urlhandler';
import { CSFloatHelpers } from '~lib/helpers/csfloat_helpers';
import { injectScript } from '~lib/helpers/inject_helper';
import {
	ICON_ARROWDOWN,
	ICON_ARROWUP_SMALL,
	ICON_ARROWUP2,
	ICON_BUFF,
	ICON_CAMERA_FLIPPED,
	ICON_CLOCK,
	ICON_CRIMSON,
	ICON_CSFLOAT,
	ICON_CSGOSKINS,
	ICON_DIAMOND_GEM_1,
	ICON_DIAMOND_GEM_2,
	ICON_DIAMOND_GEM_3,
	ICON_EMERALD_1,
	ICON_EMERALD_2,
	ICON_EMERALD_3,
	ICON_NOCTS_1,
	ICON_NOCTS_2,
	ICON_NOCTS_3,
	ICON_OVERPRINT_ARROW,
	ICON_OVERPRINT_FLOWER,
	ICON_OVERPRINT_MIXED,
	ICON_OVERPRINT_POLYGON,
	ICON_PHOENIX,
	ICON_PINK_GALAXY_1,
	ICON_PINK_GALAXY_2,
	ICON_PINK_GALAXY_3,
	ICON_PRICEMPIRE,
	ICON_PRICEMPIRE_APP,
	ICON_RUBY_1,
	ICON_RUBY_2,
	ICON_RUBY_3,
	ICON_SAPPHIRE_1,
	ICON_SAPPHIRE_2,
	ICON_SAPPHIRE_3,
	ICON_SPIDER_WEB,
	ICON_STEAM,
	ICON_STEAMANALYST,
	isProduction,
	MarketSource,
} from '~lib/util/globals';
import { createNotificationMessage, fetchBlueGemPastSales } from '~lib/util/messaging';
import { ButterflyGemMapping, DiamonGemMapping, KarambitGemMapping, NoctsMapping, PinkGalaxyMapping } from '~lib/util/patterns';
import type { IStorage } from '~lib/util/storage';
import { getAllSettings, getSetting } from '~lib/util/storage';
import { generatePriceLine, getSourceIcon } from '~lib/util/uigeneration';
import { activateHandler, initPriceMapping } from '../lib/handlers/eventhandler';
import { getCrimsonWebMapping, getItemPrice, getMarketID } from '../lib/handlers/mappinghandler';
import {
	CurrencyFormatter,
	calculateEpochFromDate,
	calculateTime,
	checkUserPlanPro,
	getBlueGemName,
	getBuffPrice,
	getCharmColoring,
	getCollectionLink,
	getFloatColoring,
	getSPBackgroundColor,
	handleSpecialStickerNames,
	isUserPro,
	waitForElement,
} from '../lib/util/helperfunctions';

export const config: PlasmoCSConfig = {
	matches: ['https://*.csfloat.com/*'],
	run_at: 'document_end',
	css: ['../css/hint.min.css', '../css/common_styles.css', '../css/csfloat_styles.css'],
};

if (navigator.userAgent.indexOf('Firefox') > -1) {
	injectScript();
}
init();

async function init() {
	console.time('[BetterFloat] CSFloat init timer');

	if (location.host !== 'csfloat.com' && !location.host.endsWith('.csfloat.com')) {
		return;
	}

	// catch the events thrown by the script
	// this has to be done as first thing to not miss timed events
	activateHandler();

	extensionSettings = await getAllSettings();

	if (!extensionSettings['csf-enable']) return;

	await initPriceMapping(extensionSettings, 'csf');

	console.timeEnd('[BetterFloat] CSFloat init timer');

	// it makes sense to init UI elements first as it takes some time to load
	// this leaves room for the website to finish loading before trying to detect items
	dynamicUIHandler();

	await firstLaunch();

	// mutation observer is only needed once
	if (!isObserverActive) {
		isObserverActive = true;
		applyMutation();
		console.log('[BetterFloat] Mutation observer started');
	}
}

// required as mutation does not detect initial DOM
async function firstLaunch() {
	let items = document.querySelectorAll('item-card');
	let tries = 20;
	while (items.length === 0 && tries-- > 0) {
		await new Promise((r) => setTimeout(r, 100));
		items = document.querySelectorAll('item-card');
	}
	// console.log('[BetterFloat] Found', items.length, 'items');

	for (let i = 0; i < items.length; i++) {
		const popoutVersion = items[i].getAttribute('width')?.includes('100%')
			? POPOUT_ITEM.PAGE
			: items[i].className.includes('flex-item') || location.pathname === '/'
				? POPOUT_ITEM.NONE
				: POPOUT_ITEM.SIMILAR;
		await adjustItem(items[i], popoutVersion);
	}

	if (items.length < 40) {
		const newItems = document.querySelectorAll('item-card');
		for (let i = 0; i < newItems.length; i++) {
			const popoutVersion = newItems[i].getAttribute('width')?.includes('100%')
				? POPOUT_ITEM.PAGE
				: newItems[i].className.includes('flex-item') || location.pathname === '/'
					? POPOUT_ITEM.NONE
					: POPOUT_ITEM.SIMILAR;
			await adjustItem(newItems[i], popoutVersion);
		}
	}

	if (location.pathname.startsWith('/item/')) {
		// enhance item page
		let popoutItem = document.querySelector('.grid-item > item-card');
		if (!popoutItem?.querySelector('.betterfloat-buff-a')) {
			while (!popoutItem) {
				await new Promise((r) => setTimeout(r, 100));
				popoutItem = document.querySelector('.grid-item > item-card');
			}
			await adjustItem(popoutItem, POPOUT_ITEM.PAGE);
		}

		// enhance similar items
		let similarItems = document.querySelectorAll('app-similar-items item-card');
		while (!similarItems || similarItems.length === 0) {
			await new Promise((r) => setTimeout(r, 100));
			similarItems = document.querySelectorAll('app-similar-items item-card');
		}
		for (const item of similarItems) {
			await adjustItem(item, POPOUT_ITEM.SIMILAR);
		}
	}

	// refresh prices every hour if user has pro plan
	if (await checkUserPlanPro(extensionSettings['user'])) {
		refreshInterval = setInterval(
			async () => {
				console.log('[BetterFloat] Refreshing prices (hourly) ...');
				// check if extension is still enabled
				if (refreshInterval) {
					let manifest: chrome.runtime.Manifest | undefined;
					try {
						manifest = chrome.runtime.getManifest();
					} catch (e) {
						console.error('[BetterFloat] Error getting manifest:', e);
					}
					if (!manifest) {
						clearInterval(refreshInterval);
						return;
					}
				}
				await initPriceMapping(extensionSettings, 'csf');
			},
			1000 * 60 * 61
		);
	}
}

function offerItemClickListener(listItem: Element) {
	listItem.addEventListener('click', async () => {
		await new Promise((r) => setTimeout(r, 100));
		const itemCard = document.querySelector('item-card');
		if (itemCard) {
			await adjustItem(itemCard);
		}
	});
}

function applyMutation() {
	const observer = new MutationObserver(async (mutations) => {
		if (await getSetting('csf-enable')) {
			for (let i = 0; i < unsupportedSubPages.length; i++) {
				if (location.href.includes(unsupportedSubPages[i])) {
					console.debug('[BetterFloat] Current page is currently NOT supported');
					return;
				}
			}
			for (const mutation of mutations) {
				for (let i = 0; i < mutation.addedNodes.length; i++) {
					const addedNode = mutation.addedNodes[i];
					// some nodes are not elements, so we need to check
					if (!(addedNode instanceof HTMLElement)) continue;
					// console.debug('[BetterFloat] Mutation detected:', addedNode);

					// item popout
					if (addedNode.tagName.toLowerCase() === 'item-detail') {
						await adjustItem(addedNode, POPOUT_ITEM.PAGE);
						// item from listings
					} else if (addedNode.tagName.toLowerCase() === 'app-stall-view') {
						// adjust stall
						// await customStall(location.pathname.split('/').pop() ?? '');
					} else if (addedNode.tagName === 'ITEM-CARD') {
						await adjustItem(addedNode, addedNode.className.includes('flex-item') || location.pathname === '/' ? POPOUT_ITEM.NONE : POPOUT_ITEM.SIMILAR);
					} else if (addedNode.tagName === 'ITEM-LATEST-SALES') {
						await adjustLatestSales(addedNode);
					} else if (addedNode.className.toString().includes('mat-mdc-header-row')) {
						// header of the latest sales table of an item popup
					} else if (addedNode.className.toString().includes('chart-container')) {
						// header of the latest sales table of an item popup
						await adjustChartContainer(addedNode);
					} else if (location.pathname === '/profile/offers' && addedNode.className.startsWith('container')) {
						// item in the offers page when switching from another page
						await adjustOfferContainer(addedNode);
					} else if (location.pathname === '/profile/offers' && addedNode.className.toString().includes('mat-list-item')) {
						// offer list in offers page
						offerItemClickListener(addedNode);
					} else if (addedNode.tagName.toLowerCase() === 'app-markdown-dialog') {
						CSFloatHelpers.adjustCurrencyChangeNotice(addedNode);
					} else if (location.pathname.includes('/item/') && addedNode.id?.length > 0) {
						if (addedNode.querySelector('path[d="M6.26953 12.8371H10.5998V14.9125H6.26953V17.3723H12.8674V10.736H8.48589V8.78871H12.8674V6.48267H6.26953V12.8371Z"]') && isProduction) {
							addedNode.remove();
						}
					} else if (addedNode.tagName.toLowerCase() === 'tbody' && extensionSettings['csf-buyorderpercentage'] && addedNode.closest('app-order-table')) {
						addBuyOrderPercentage(addedNode);
					}
				}
			}
		}
	});
	observer.observe(document, { childList: true, subtree: true });
}

type DOMBuffData = {
	priceOrder: number;
	priceListing: number;
	userCurrency: string;
	itemName: string;
	priceFromReference: number;
};

export async function adjustOfferContainer(container: Element) {
	const offers = Array.from(document.querySelectorAll('.offers .offer'));
	const offerIndex = offers.findIndex((el) => el.className.includes('is-selected'));
	const offer = getSpecificCSFOffer(offerIndex);

	if (!offer) return;

	const header = container.querySelector('.header');

	const itemName = offer.contract.item.market_hash_name;
	let itemStyle: ItemStyle = '';
	if (offer.contract.item.phase) {
		itemStyle = offer.contract.item.phase;
	} else if (offer.contract.item.paint_index === 0) {
		itemStyle = 'Vanilla';
	}
	const source = extensionSettings['csf-pricingsource'] as MarketSource;
	const buff_id = await getMarketID(itemName, source);
	const { priceListing, priceOrder } = await getBuffPrice(itemName, itemStyle, source);
	const useOrderPrice =
		priceOrder &&
		extensionSettings['csf-pricereference'] === 0 &&
		([MarketSource.Buff, MarketSource.Steam].includes(source) || (MarketSource.YouPin === source && isUserPro(extensionSettings['user'])));
	const priceFromReference = useOrderPrice ? priceOrder : (priceListing ?? new Decimal(0));

	const userCurrency = CSFloatHelpers.userCurrency();

	const buffContainer = generatePriceLine({
		source: extensionSettings['csf-pricingsource'] as MarketSource,
		market_id: buff_id,
		buff_name: itemName,
		priceOrder,
		priceListing,
		priceFromReference,
		userCurrency,
		itemStyle: '' as DopplerPhase,
		CurrencyFormatter: CurrencyFormatter(CSFloatHelpers.userCurrency()),
		isDoppler: false,
		isPopout: false,
		iconHeight: '20px',
		hasPro: isUserPro(extensionSettings['user']),
	});
	header?.insertAdjacentHTML('beforeend', buffContainer);

	const buffA = container.querySelector('.betterfloat-buff-a');
	buffA?.setAttribute('data-betterfloat', JSON.stringify({ priceOrder, priceListing, userCurrency, itemName, priceFromReference }));
}

function getJSONAttribute<T = any>(data: string | null | undefined): T | null {
	if (!data) return null;
	return JSON.parse(data) as T;
}

async function adjustBargainPopup(itemContainer: Element, popupContainer: Element) {
	const itemCard = popupContainer.querySelector('item-card');
	if (!itemCard) return;

	let item = getJSONAttribute<CSFloat.ListingData>(itemContainer.getAttribute('data-betterfloat'));
	let buff_data = getJSONAttribute(itemContainer.querySelector('.betterfloat-buff-a')?.getAttribute('data-betterfloat'));
	let stickerData = getJSONAttribute(itemContainer.querySelector('.sticker-percentage')?.getAttribute('data-betterfloat'));

	let i = 0;
	while (!item && i++ < 20) {
		await new Promise((r) => setTimeout(r, 100));
		item = getJSONAttribute<CSFloat.ListingData>(itemContainer.getAttribute('data-betterfloat'));
		buff_data = getJSONAttribute(itemContainer.querySelector('.betterfloat-buff-a')?.getAttribute('data-betterfloat'));
		stickerData = getJSONAttribute(itemContainer.querySelector('.sticker-percentage')?.getAttribute('data-betterfloat'));
	}

	if (!item) return;

	CSFloatHelpers.storeApiItem(itemCard, item);

	await adjustItem(itemCard, POPOUT_ITEM.BARGAIN);

	await mountCSFBargainButtons();

	// console.log('[BetterFloat] Bargain popup data:', itemContainer, item, buff_data, stickerData);
	if (buff_data?.priceFromReference && buff_data.priceFromReference > 0 && item?.min_offer_price) {
		const currency = getSymbolFromCurrency(buff_data.userCurrency);
		const minOffer = new Decimal(item.min_offer_price).div(100).minus(buff_data.priceFromReference);
		const minPercentage = minOffer.greaterThan(0) && stickerData?.priceSum ? minOffer.div(stickerData.priceSum).mul(100).toDP(2).toNumber() : 0;
		const showSP = stickerData?.priceSum > 0;

		const spStyle = `display: ${showSP ? 'block' : 'none'}; background-color: ${getSPBackgroundColor(stickerData?.spPercentage ?? 0)}`;
		const diffStyle = `background-color: ${minOffer.isNegative() ? extensionSettings['csf-color-profit'] : extensionSettings['csf-color-loss']}`;
		const bargainTags = html`
			<div style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; margin-left: 10px;">
				<span class="betterfloat-bargain-text" style="${diffStyle}">
					${minOffer.isNegative() ? '-' : '+'}${currency}${minOffer.absoluteValue().toDP(2).toNumber()}
				</span>
				<span class="betterfloat-sticker-percentage" style="${spStyle}">${minPercentage}% SP</span>
			</div>
		`;

		const minContainer = popupContainer.querySelector('.minimum-offer');
		if (minContainer) {
			minContainer.insertAdjacentHTML('beforeend', bargainTags);
		}

		const inputField = popupContainer.querySelector<HTMLInputElement>('input');
		if (!inputField) return;
		inputField.parentElement?.setAttribute('style', 'display: flex; align-items: center; justify-content: space-between;');
		inputField.insertAdjacentHTML(
			'afterend',
			html`
				<div style="position: relative; display: inline-flex; flex-direction: column; align-items: flex-end; gap: 8px; font-size: 16px; white-space: nowrap;">
					<span class="betterfloat-bargain-text betterfloat-bargain-diff" style="${diffStyle} cursor: pointer;"></span>
					${showSP && `<span class="betterfloat-sticker-percentage betterfloat-bargain-sp" style="${spStyle}"></span>`}
				</div>
			`
		);

		const diffElement = popupContainer.querySelector<HTMLElement>('.betterfloat-bargain-diff');
		const spElement = popupContainer.querySelector<HTMLElement>('.betterfloat-bargain-sp');
		let absolute = false;

		const calculateDiff = () => {
			const inputPrice = new Decimal(inputField.value ?? 0);
			if (absolute) {
				const diff = inputPrice.minus(buff_data.priceFromReference);
				if (diffElement) {
					diffElement.textContent = `${diff.isNegative() ? '-' : '+'}${currency}${diff.absoluteValue().toDP(2).toNumber()}`;
					diffElement.style.backgroundColor = `${diff.isNegative() ? extensionSettings['csf-color-profit'] : extensionSettings['csf-color-loss']}`;
				}
			} else {
				const diff = inputPrice.div(buff_data.priceFromReference).mul(100);
				const percentage = stickerData?.priceSum ? inputPrice.minus(buff_data.priceFromReference).div(stickerData.priceSum).mul(100).toDP(2) : null;
				if (diffElement) {
					diffElement.textContent = `${diff.absoluteValue().toDP(2).toNumber()}%`;
					diffElement.style.backgroundColor = `${diff.lessThan(100) ? extensionSettings['csf-color-profit'] : extensionSettings['csf-color-loss']}`;
				}
				if (spElement && percentage) {
					if (percentage.lessThan(0)) {
						spElement.style.display = 'none';
					} else {
						spElement.style.display = 'block';
						spElement.textContent = `${percentage.toNumber()}% SP`;
						spElement.style.border = '1px solid grey';
					}
				}
			}
		};

		inputField.addEventListener('input', () => {
			calculateDiff();
		});

		diffElement?.addEventListener('click', () => {
			absolute = !absolute;
			calculateDiff();
		});
	}
}

async function adjustLatestSales(addedNode: Element) {
	const rowSelector = 'tbody tr.mdc-data-table__row';
	let rows = addedNode.querySelectorAll(rowSelector);
	let tries = 20;
	while (rows.length === 0 && tries-- > 0) {
		await new Promise((r) => setTimeout(r, 100));
		rows = addedNode.querySelectorAll(rowSelector);
	}
	for (const row of rows) {
		await adjustSalesTableRow(row);
	}
}

async function adjustSalesTableRow(container: Element) {
	const cachedSale = getFirstHistorySale();
	if (!cachedSale) {
		return;
	}
	const item = cachedSale.item;

	const priceData = getJSONAttribute(document.querySelector('.betterfloat-big-price')?.getAttribute('data-betterfloat'));
	if (!priceData.priceFromReference) return;
	const { currencyRate } = await getCurrencyRate();
	const priceDiff = new Decimal(cachedSale.price).mul(currencyRate).div(100).minus(priceData.priceFromReference);
	// add Buff price difference
	const priceContainer = container.querySelector('.price-wrapper');
	if (priceContainer && extensionSettings['csf-buffdifference']) {
		priceContainer.querySelector('app-reference-widget')?.remove();
		const priceDiffElement = html`
			<div
				class="betterfloat-table-item-sp"
				style="font-size: 14px; padding: 2px 5px; border-radius: 7px; color: white; background-color: ${
					priceDiff.isNegative() ? extensionSettings['csf-color-profit'] : extensionSettings['csf-color-loss']
				}"
				data-betterfloat="${priceDiff.toDP(2).toNumber()}"
			>
				${priceDiff.isNegative() ? '-' : '+'}${getSymbolFromCurrency(priceData.userCurrency)}${priceDiff.absoluteValue().toDP(2).toNumber()}
			</div>
		`;
		priceContainer.insertAdjacentHTML('beforeend', priceDiffElement);
	}

	// add sticker percentage
	const appStickerView = container.querySelector<HTMLElement>('app-sticker-view');
	const stickerData = item.stickers;
	if (appStickerView && stickerData && item?.quality !== 12 && extensionSettings['csf-stickerprices']) {
		appStickerView.style.justifyContent = 'center';
		if (stickerData.length > 0) {
			const stickerContainer = document.createElement('div');
			stickerContainer.className = 'betterfloat-table-sp';
			(<HTMLElement>appStickerView).style.display = 'flex';
			(<HTMLElement>appStickerView).style.alignItems = 'center';

			const doChange = await changeSpContainer(stickerContainer, stickerData, priceDiff.toNumber());
			if (doChange) {
				appStickerView.appendChild(stickerContainer);
			}
		}
	}

	// add keychain coloring
	const patternContainer = container.querySelector('.cdk-column-pattern')?.firstElementChild;
	if (patternContainer && item.keychain_pattern) {
		const pattern = item.keychain_pattern;
		const badgeProps = getCharmColoring(pattern, item.item_name);

		const patternCell = html`
			<div style="display: flex; align-items: center; justify-content: center;">
				<div style="background-color: ${badgeProps[0]}80; padding: 5px; border-radius: 7px;">
					<span style="color: ${badgeProps[1]}">#${pattern}</span>
				</div>
			</div>
		`;
		patternContainer.outerHTML = patternCell;
	}

	// add float coloring
	const itemSchema = getItemSchema(cachedSale.item);
	if (itemSchema && cachedSale.item.float_value && extensionSettings['csf-floatcoloring']) {
		const floatContainer = container.querySelector('td.mat-column-wear')?.firstElementChild;
		if (floatContainer) {
			const lowestRank = Math.min(cachedSale.item.low_rank || 99, cachedSale.item.high_rank || 99);
			const floatColoring = getRankedFloatColoring(cachedSale.item.float_value!, itemSchema.min, itemSchema.max, cachedSale.item.paint_index === 0, lowestRank);
			if (floatColoring !== '') {
				floatContainer.setAttribute('style', `color: ${floatColoring}`);
			}
		}
	}

	// add row coloring if same item
	const itemWear = document.querySelector('item-detail .wear')?.textContent;
	if (itemWear && cachedSale.item.float_value && new Decimal(itemWear).toDP(10).equals(cachedSale.item.float_value.toFixed(10))) {
		container.setAttribute('style', 'background-color: #0b255d;');
	}
}

async function adjustChartContainer(container: Element) {
	let chartData = getCSFHistoryGraph();

	let tries = 10;
	while (!chartData && tries-- > 0) {
		await new Promise((r) => setTimeout(r, 200));
		chartData = getCSFHistoryGraph();
	}

	if (!chartData) return;

	const rangeSelectorDiv = container.querySelector<HTMLElement>('.range-selector');
	if (!rangeSelectorDiv) return;

	const userCurrency = CSFloatHelpers.userCurrency();

	const chartPrices = chartData.map((x) => x.avg_price);
	const chartMax = Math.max(...chartPrices);
	const chartMin = Math.min(...chartPrices);

	const maxMinContainer = html`
		<div style="height: 100%; display: flex; gap: 12px; align-items: center; padding: 0 12px; background: var(--highlight-background-minimal); border-radius: 7px;">
			<span style="color: var(--subtext-color); font-weight: 500; letter-spacing: .03em; display: flex; align-items: center; gap: 4px; font-size: 14px; line-height: 24px;">
				<img src="${ICON_ARROWDOWN}" style="width: 16px; height: 16px; filter: invert(1);" alt="Min" />
				${Intl.NumberFormat(undefined, { style: 'currency', currency: userCurrency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(chartMin)}
			</span>
			<span style="color: var(--subtext-color); font-weight: 500; letter-spacing: .03em; display: flex; align-items: center; gap: 4px; font-size: 14px; line-height: 24px;">
				<img src="${ICON_ARROWUP2}" style="width: 16px; height: 16px; filter: invert(1);" alt="Max" />
				${Intl.NumberFormat(undefined, { style: 'currency', currency: userCurrency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(chartMax)}
			</span>
		</div>
	`;
	rangeSelectorDiv.insertAdjacentHTML('afterbegin', maxMinContainer);

	rangeSelectorDiv.setAttribute('style', 'width: 100%; display: flex; justify-content: space-between; align-items: center;');
}

enum POPOUT_ITEM {
	NONE = 0,
	PAGE = 1,
	BARGAIN = 2,
	SIMILAR = 3,
}

function addScreenshotListener(container: Element, item: CSFloat.Item) {
	const screenshotButton = container.querySelector('.detail-buttons mat-icon.mat-ligature-font');
	if (!screenshotButton?.textContent?.includes('photo_camera') || !item.cs2_screenshot_at) {
		return;
	}

	screenshotButton.parentElement?.addEventListener('click', async () => {
		waitForElement('app-screenshot-dialog').then((screenshotDialog) => {
			if (!screenshotDialog || !item.cs2_screenshot_at) return;
			const screenshotContainer = document.querySelector('app-screenshot-dialog');
			if (!screenshotContainer) return;

			const date = new Date(item.cs2_screenshot_at).toLocaleDateString('en-US');
			const inspectedAt = html`
				<div
					class="betterfloat-screenshot-date"
					style="position: absolute;left: 0;bottom: 25px;background-color: var(--dialog-background);-webkit-backdrop-filter: blur(var(--highlight-blur));backdrop-filter: blur(var(--highlight-blur));padding: 5px 10px;font-size: 14px;border-top-right-radius: 6px;color: var(--subtext-color);z-index: 2;"
				>
					<span>Inspected at ${date}</span>
				</div>
			`;

			screenshotContainer.querySelector('.mat-mdc-tab-body-wrapper')?.insertAdjacentHTML('beforeend', inspectedAt);
		});
	});
}

async function adjustItem(container: Element, popout = POPOUT_ITEM.NONE) {
	if (container.querySelector('.betterfloat-buff-a')) {
		return;
	}
	if (popout > 0) {
		// wait for popup UI to load
		await new Promise((r) => setTimeout(r, 100));
	}
	const item = getFloatItem(container);

	if (Number.isNaN(item.price)) return;
	const priceResult = await addBuffPrice(item, container, popout);

	// Currency up until this moment is stricly the user's local currency, however the sticker %
	// is done stricly in USD, we have to make sure the price difference reflects that
	const getApiItem: () => CSFloat.ListingData | null | undefined = () => {
		switch (popout) {
			case POPOUT_ITEM.NONE:
				if (location.pathname === '/sell') {
					const inventoryItem = getSpecificCSFInventoryItem(item.name, Number.isNaN(item.float) ? undefined : item.float);
					if (!inventoryItem) return undefined;
					return {
						created_at: '',
						id: '',
						is_seller: true,
						is_watchlisted: false,
						item: inventoryItem,
						price: 0,
						state: 'listed',
						type: 'buy_now',
						watchers: 0,
					} satisfies CSFloat.ListingData;
				}
				return getFirstCSFItem();
			case POPOUT_ITEM.PAGE: {
				// fallback to stored data if item is not found
				let newItem = getCSFPopupItem();
				if (!newItem || location.pathname.split('/').pop() !== newItem.id) {
					const itemPreview = document.getElementsByClassName('item-' + location.pathname.split('/').pop())[0];
					newItem = CSFloatHelpers.getApiItem(itemPreview);
				}
				return newItem;
			}
			case POPOUT_ITEM.BARGAIN:
				return getJSONAttribute<CSFloat.ListingData>(container.getAttribute('data-betterfloat'));
			case POPOUT_ITEM.SIMILAR:
				return getFirstCSFSimilarItem();
			default:
				console.error('[BetterFloat] Unknown popout type:', popout);
				return null;
		}
	};
	let apiItem = getApiItem();

	if (popout === POPOUT_ITEM.NONE) {
		// check if we got the right item
		while (apiItem && (item.name !== apiItem.item.item_name || (apiItem.item.float_value && !new Decimal(apiItem.item.float_value).toDP(12).equals(item.float)))) {
			console.log('[BetterFloat] Item name mismatch:', item, apiItem);
			apiItem = getApiItem();
		}

		if (!apiItem && location.pathname === '/sell') {
			const csfInventory = (await fetch('https://csfloat.com/api/v1/me/inventory', { method: 'GET' }).then((r) => r.json())) as CSFloat.InventoryReponse;
			cacheCSFInventory(csfInventory);
			apiItem = getApiItem();
		}

		if (!apiItem) {
			console.error('[BetterFloat] No cached item found: ', item.name, container);
			return;
		}

		if (item.name !== apiItem.item.item_name) {
			console.log('[BetterFloat] Item name mismatch:', item.name, apiItem.item.item_name);
			return;
		}

		// notification check
		if (extensionSettings['user']?.plan?.type === 'pro') {
			const autoRefreshLabel = document.querySelector('.refresh > button');
			if (autoRefreshLabel?.getAttribute('data-betterfloat-auto-refresh') === 'true') {
				await liveNotifications(apiItem, priceResult.percentage);
			}
		}

		if (extensionSettings['csf-stickerprices'] && apiItem.price > 0) {
			await addStickerInfo(container, apiItem, priceResult.price_difference);
		} else {
			adjustExistingSP(container);
		}

		if (extensionSettings['csf-floatcoloring']) {
			addFloatColoring(container, apiItem);
		}
		await patternDetections(container, apiItem, false);

		if (location.pathname !== '/sell') {
			if (extensionSettings['csf-listingage']) {
				addListingAge(container, apiItem, false);
			}
			CSFloatHelpers.storeApiItem(container, apiItem);

			if (extensionSettings['csf-removeclustering']) {
				CSFloatHelpers.removeClustering(container);
			}

			addBargainListener(container);
			addScreenshotListener(container, apiItem.item);
			if (extensionSettings['csf-showbargainprice']) {
				await showBargainPrice(container, apiItem, popout);
			}

			if (extensionSettings['csf-showingamess']) {
				CSFloatHelpers.addItemScreenshot(container, apiItem.item);
			}
		} else {
			addSaleListListener(container);
		}
	} else if (popout > 0) {
		const isMainItem = popout === POPOUT_ITEM.PAGE;
		// due to the way the popout is loaded, the data may not be available yet
		let tries = 10;
		while (
			(!apiItem ||
				(isMainItem && location.pathname.split('/').pop() !== apiItem.id) ||
				(popout === POPOUT_ITEM.BARGAIN && apiItem.item.float_value && !new Decimal(apiItem.item.float_value).toDP(12).equals(item.float))) &&
			tries-- > 0
		) {
			await new Promise((r) => setTimeout(r, 200));
			apiItem = getApiItem();
		}

		if (!apiItem) {
			console.warn('[BetterFloat] Could not find item in popout:', item.name);
			return;
		}

		if (apiItem?.id) {
			await addStickerInfo(container, apiItem, priceResult.price_difference);
			addListingAge(container, apiItem, isMainItem);
			addFloatColoring(container, apiItem);
			await patternDetections(container, apiItem, isMainItem);
			if (isMainItem) {
				addQuickLinks(container, apiItem);
				CSFloatHelpers.copyNameOnClick(container, apiItem.item);
				addCollectionLink(container);
			}
			CSFloatHelpers.storeApiItem(container, apiItem);
			await showBargainPrice(container, apiItem, popout);
			if (extensionSettings['csf-showingamess'] || isMainItem) {
				CSFloatHelpers.addItemScreenshot(container, apiItem.item);
			}
			addScreenshotListener(container, apiItem.item);
		}
		addBargainListener(container);
	}
}

function addSaleListListener(container: Element) {
	if (!isUserPro(extensionSettings['user'])) return;

	const sellSettings = localStorage.getItem('betterfloat-sell-settings');
	if (!sellSettings) return;
	const { active, displayBuff, percentage } = JSON.parse(sellSettings) as CSFloat.SellSettings;

	const saleButton = container.querySelector('div.action > button');
	if (saleButton) {
		saleButton.addEventListener('click', () => {
			adjustSaleListItem(container, active, displayBuff, percentage);
		});
	}
}

async function adjustSaleListItem(container: Element, active: boolean, displayBuff: boolean, percentage: number) {
	console.log('[BetterFloat] Adjusting sale list item:', active, displayBuff, percentage);
	const listItem = Array.from(document.querySelectorAll('app-sell-queue-item')).pop();
	if (!listItem) return;

	const buffA = container.querySelector('a.betterfloat-buff-a')?.cloneNode(true) as HTMLElement;
	const buffData = JSON.parse(buffA?.getAttribute('data-betterfloat') ?? '{}') as DOMBuffData;
	console.log('[BetterFloat] Buff data:', buffData);
	if (!buffA || !buffData) return;

	if (displayBuff) {
		const sliderWrapper = listItem.querySelector('div.slider-wrapper');
		if (!sliderWrapper) return;

		buffA.style.justifyContent = 'center';
		sliderWrapper.before(buffA);
	}

	const priceInput = listItem.querySelector<HTMLInputElement>('input[formcontrolname="price"]');
	const priceLabel = listItem.querySelector<HTMLElement>('.price .name');
	if (!priceInput) return;

	priceInput.addEventListener('input', (e) => {
		if (!(e.target instanceof HTMLInputElement) || !priceLabel) return;
		const price = new Decimal(e.target.value).toDP(2);
		const percentage = new Decimal(price).div(buffData.priceFromReference).mul(100).toDP(2);

		priceLabel.textContent = `Price (${percentage.toFixed(2)}%)`;
	});

	if (active && !Number.isNaN(percentage) && percentage > 0 && buffData.priceFromReference) {
		const targetPrice = new Decimal(Number(buffData.priceFromReference)).mul(percentage).div(100).toDP(2);
		priceInput.value = targetPrice.toString();
		priceInput.dispatchEvent(new Event('input', { bubbles: true }));

		priceInput.closest('div.mat-mdc-text-field-wrapper')?.setAttribute('style', 'border: 1px solid rgb(107 33 168);');
	}
}

async function addBuyOrderPercentage(container: Element) {
	const sourceIcon = getSourceIcon(extensionSettings['csf-pricingsource'] as MarketSource);
	const bigPriceElement = document.querySelector<HTMLElement>('div.betterfloat-big-price');
	const referencePrice = Number(JSON.parse(bigPriceElement?.getAttribute('data-betterfloat') ?? '{}').priceFromReference ?? 0);
	if (!referencePrice) {
		return;
	}

	let buyOrderEntries = container.querySelectorAll('tr');
	let tries = 10;
	while (buyOrderEntries.length === 0 && tries-- > 0) {
		await new Promise((r) => setTimeout(r, 100));
		buyOrderEntries = container.querySelectorAll('tr');
	}
	if (buyOrderEntries.length === 0) {
		return;
	}
	const buyOrders = getCSFAllBuyOrders();

	buyOrderEntries.forEach((entry, index) => {
		const data = buyOrders[index];
		if (!data) {
			return;
		}
		const percentage = new Decimal(data.price).div(100).div(referencePrice).mul(100).toDP(2);
		const percentageText = html`
			<div class="betterfloat-buyorder-percentage">
				<img src="${sourceIcon.logo}" style="${sourceIcon.style}" />
				<span>${percentage.toFixed(2)}%</span>
			</div>
		`;
		entry.querySelector('td.mat-column-price')?.insertAdjacentHTML('beforeend', percentageText);
		(entry.firstElementChild as HTMLElement).style.paddingRight = '0';
	});
}

async function liveNotifications(apiItem: CSFloat.ListingData, percentage: Decimal) {
	const notificationSettings: CSFloat.BFNotification = localStorage.getItem('betterfloat-notification')
		? JSON.parse(localStorage.getItem('betterfloat-notification') ?? '')
		: { active: false, name: '', priceBelow: 0 };

	if (notificationSettings.active) {
		const item = apiItem.item;
		if (notificationSettings.name && notificationSettings.name.trim().length > 0 && !item.market_hash_name.includes(notificationSettings.name)) {
			return;
		}

		if (percentage.gte(notificationSettings.percentage) || percentage.lt(1)) {
			return;
		}

		if (
			notificationSettings.floatRanges &&
			notificationSettings.floatRanges.length === 2 &&
			(notificationSettings.floatRanges[0] > 0 || notificationSettings.floatRanges[1] < 1) &&
			(!item.float_value || item.float_value < notificationSettings.floatRanges[0] || item.float_value > notificationSettings.floatRanges[1])
		) {
			return;
		}

		if (apiItem.type === 'auction') {
			return;
		}

		const { userCurrency, currencyRate } = await getCurrencyRate();
		const currencySymbol = getSymbolFromCurrency(userCurrency);

		let priceText = new Decimal(apiItem.price).div(100).mul(currencyRate).toFixed(2);
		if (currencySymbol === '€') {
			priceText += currencySymbol;
		} else {
			priceText = currencySymbol + priceText;
		}

		// show notification
		const title = 'Item Found | BetterFloat Pro';
		const body = `${percentage.toFixed(2)}% Buff (${priceText}): ${item.market_hash_name}`;
		if (notificationSettings.browser) {
			// create new notification
			const notification = new Notification(title, {
				body,
				icon: ICON_CSFLOAT,
				tag: 'betterfloat-notification-' + String(apiItem.id),
				silent: false,
			});
			notification.onclick = () => {
				window.open(`https://csfloat.com/item/${apiItem.id}`, '_blank');
			};
			notification.onerror = () => {
				console.error('[BetterFloat] Error creating notification:', notification);
			};
		} else {
			await createNotificationMessage({
				id: apiItem.id,
				site: 'csfloat',
				title,
				message: body,
			});
		}
	}
}

function addCollectionLink(container: Element) {
	const collectionLink = container.querySelector('div.collection');
	if (collectionLink?.textContent) {
		const link = html`
			<a href="${getCollectionLink(collectionLink.textContent)}" target="_blank">
			 	${collectionLink.textContent}
			</a>
		`;
		collectionLink.innerHTML = link;
	}
}

async function showBargainPrice(container: Element, listing: CSFloat.ListingData, popout: POPOUT_ITEM) {
	const buttonLabel = container.querySelector('.bargain-btn > button > span.mdc-button__label');
	if (listing.min_offer_price && buttonLabel && !buttonLabel.querySelector('.betterfloat-minbargain-label')) {
		const { userCurrency, currencyRate } = await getCurrencyRate();
		const minBargainLabel = html`
			<span class="betterfloat-minbargain-label" style="color: var(--subtext-color);">
				(${popout === POPOUT_ITEM.PAGE ? 'min. ' : ''}${Intl.NumberFormat(undefined, {
					style: 'currency',
					currency: userCurrency,
					currencyDisplay: 'narrowSymbol',
					minimumFractionDigits: 0,
					maximumFractionDigits: 2,
				}).format(new Decimal(listing.min_offer_price).mul(currencyRate).div(100).toDP(2).toNumber())})
			</span>
		`;

		buttonLabel.insertAdjacentHTML('beforeend', minBargainLabel);
		if (popout === POPOUT_ITEM.PAGE) {
			buttonLabel.setAttribute('style', 'display: flex; flex-direction: column;');
		}
	}
}

function addBargainListener(container: Element | null) {
	if (!container) return;
	const bargainBtn = container.querySelector('.bargain-btn > button');
	if (bargainBtn) {
		bargainBtn.addEventListener('click', () => {
			let tries = 10;
			const interval = setInterval(async () => {
				if (tries-- <= 0) {
					clearInterval(interval);
					return;
				}
				const bargainPopup = document.querySelector('app-make-offer-dialog');
				if (bargainPopup) {
					clearInterval(interval);
					await adjustBargainPopup(container, bargainPopup);
				}
			}, 500);
		});
	}
}

function getAlternativeItemLink(item: CSFloat.Item) {
	const namePart = item.item_name.toLowerCase().replace('★ ', '').replace(' | ', '-').replaceAll(' ', '-').replaceAll(':', '');
	const wearPart = item.wear_name ? `/${item.is_stattrak ? 'stattrak-' : ''}${item.wear_name.toLowerCase().replaceAll(' ', '-')}` : '';
	return namePart + wearPart;
}

type QuickLink = {
	icon: string;
	tooltip: string;
	link: string;
};

function addQuickLinks(container: Element, listing: CSFloat.ListingData) {
	const actionsContainer = document.querySelector('.item-actions');
	if (!actionsContainer) return;

	actionsContainer.setAttribute('style', 'flex-wrap: wrap;');
	const altURL = getAlternativeItemLink(listing.item);
	const pricempireURL = createPricempireItemLink(container, listing.item);
	let buff_name = listing.item.market_hash_name;
	if (listing.item.phase) {
		buff_name += ` - ${listing.item.phase}`;
	}
	const quickLinks: QuickLink[] = [
		{
			icon: ICON_CSGOSKINS,
			tooltip: 'Show CSGOSkins.gg Page',
			link: `https://csgoskins.gg/items/${altURL}?utm_source=betterfloat`,
		},
		{
			icon: ICON_STEAMANALYST,
			tooltip: 'Show SteamAnalyst Page',
			link: `https://csgo.steamanalyst.com/skin/${altURL.replace('/', '-')}?utm_source=betterfloat`,
		},
		{
			icon: ICON_PRICEMPIRE_APP,
			tooltip: 'Show Pricempire App Page',
			link: `https://app.pricempire.com/item/cs2/${pricempireURL}?utm_source=betterfloat`,
		},
		{
			icon: ICON_PRICEMPIRE,
			tooltip: 'Show Pricempire Page',
			link: `https://pricempire.com/item/${buff_name}`,
		},
	];
	// inventory link if seller stall is public
	if (listing.seller?.stall_public) {
		quickLinks.push({
			icon: ICON_STEAM,
			tooltip: "Show in Seller's Inventory",
			link: 'https://steamcommunity.com/profiles/' + listing.seller.steam_id + '/inventory/#730_2_' + listing.item.asset_id,
		});
	}

	const quickLinksContainer = html`
		<div class="betterfloat-quicklinks" style="flex-basis: 100%; display: flex; justify-content: space-evenly;">
			${quickLinks
				.map(
					(link) => html`
						<div class="bf-tooltip">
							<a class="mat-icon-button" href="${link.link}" target="_blank">
								<img src="${link.icon}" style="height: 24px; border-radius: 5px; vertical-align: middle;" />
							</a>
							<div class="bf-tooltip-inner" style="translate: -60px 10px; width: 140px;">
								<span>${link.tooltip}</span>
							</div>
						</div>
					`
				)
				.join('')}
		</div>
	`;

	if (!actionsContainer.querySelector('.betterfloat-quicklinks')) {
		actionsContainer.insertAdjacentHTML('beforeend', quickLinksContainer);
	}
}

function createPricempireItemLink(container: Element, item: CSFloat.Item) {
	const itemType = (item: CSFloat.Item) => {
		if (item.type === 'container' && !item.item_name.includes('Case')) {
			return 'sticker-capsule';
		}
		return item.type;
	};
	const sanitizeURL = (url: string) => {
		return url.replace(/\s\|/g, '').replace('(', '').replace(')', '').replace('™', '').replace('★ ', '').replace(/\s+/g, '-');
	};

	return `${itemType(item)}/${sanitizeURL(createBuffName(getFloatItem(container)).toLowerCase())}${item.phase ? `-${sanitizeURL(item.phase.toLowerCase())}` : ''}`;
}

function getItemSchema(item: CSFloat.Item): CSFloat.ItemSchema.SingleSchema | null {
	if (item.type !== 'skin') {
		return null;
	}

	if (!ITEM_SCHEMA) {
		ITEM_SCHEMA = JSON.parse(window.sessionStorage.ITEM_SCHEMA_V2 || '{}').schema ?? {};
	}

	if (Object.keys(ITEM_SCHEMA ?? {}).length === 0) {
		return null;
	}

	const names = item.item_name.split(' | ');
	if (names[0].includes('★')) {
		names[0] = names[0].replace('★ ', '');
	}
	if (item.paint_index === 0) {
		names[1] = 'Vanilla';
	}
	if (item.phase) {
		names[1] += ` (${item.phase})`;
	}

	const weapon = Object.values((<CSFloat.ItemSchema.TypeSchema>ITEM_SCHEMA).weapons).find((el) => el.name === names[0]);
	if (!weapon) return null;

	return Object.values(weapon['paints']).find((el) => el.name === names[1]) as CSFloat.ItemSchema.SingleSchema;
}

function addFloatColoring(container: Element, listing: CSFloat.ListingData) {
	if (!listing.item.float_value) return;
	const itemSchema = getItemSchema(listing.item);

	const element = container.querySelector<HTMLElement>('div.wear');
	if (element) {
		const lowestRank = Math.min(listing.item.low_rank || 99, listing.item.high_rank || 99);
		const floatColoring = getRankedFloatColoring(listing.item.float_value, itemSchema?.min ?? 0, itemSchema?.max ?? 1, listing.item.paint_index === 0, lowestRank);
		if (floatColoring !== '') {
			element.style.color = floatColoring;
		}
	}
}

function getRankedFloatColoring(float: number, min: number, max: number, vanilla: boolean, rank: number) {
	switch (rank) {
		case 1:
			return '#efbf04';
		case 2:
		case 3:
			return '#d9d9d9';
		case 4:
		case 5:
			return '#f5a356';
		default:
			return getFloatColoring(float, min, max, vanilla);
	}
}

async function patternDetections(container: Element, listing: CSFloat.ListingData, isPopout: boolean) {
	const item = listing.item;
	if (item.item_name.includes('Case Hardened') || item.item_name.includes('Heat Treated')) {
		if (extensionSettings['csf-csbluegem'] && isPopout) {
			await addCaseHardenedSales(item);
		}
	} else if (item.item_name.includes('Fade')) {
		// csfloat supports fades natively now
	} else if ((item.item_name.includes('Crimson Web') || item.item_name.includes('Emerald Web')) && item.item_name.startsWith('★')) {
		await webDetection(container, item);
	} else if (item.item_name.includes('Specialist Gloves | Crimson Kimono')) {
		await badgeCKimono(container, item);
	} else if (item.item_name.includes('Phoenix Blacklight')) {
		await badgePhoenix(container, item);
	} else if (item.item_name.includes('Overprint')) {
		await badgeOverprint(container, item);
	} else if (item.phase) {
		if (item.phase === 'Ruby' || item.phase === 'Sapphire' || item.phase === 'Emerald') {
			await badgeChromaGems(container, item);
		} else if (item.item_name.includes('Karambit | Doppler') && item.phase === 'Phase 2') {
			await badgePinkGalaxy(container, item);
		} else if (item.item_name.includes('Karambit | Gamma Doppler') && item.phase === 'Phase 1') {
			await badgeDiamondGem(container, item);
		}
	} else if (item.item_name.includes('Nocts')) {
		await badgeNocts(container, item);
	} else if (item.type === 'charm') {
		badgeCharm(container, item);
	}
}

async function badgeChromaGems(container: Element, item: CSFloat.Item) {
	let gem_data: number | undefined;
	if (item.item_name.includes('Karambit')) {
		gem_data = KarambitGemMapping[item.paint_seed!];
	} else if (item.item_name.includes('Butterfly Knife')) {
		gem_data = ButterflyGemMapping[item.paint_seed!];
	}
	if (!gem_data) return;

	const iconMapping = {
		Sapphire: {
			1: ICON_SAPPHIRE_1,
			2: ICON_SAPPHIRE_2,
			3: ICON_SAPPHIRE_3,
		},
		Ruby: {
			1: ICON_RUBY_1,
			2: ICON_RUBY_2,
			3: ICON_RUBY_3,
		},
		Emerald: {
			1: ICON_EMERALD_1,
			2: ICON_EMERALD_2,
			3: ICON_EMERALD_3,
		},
	};

	CSFloatHelpers.addPatternBadge({
		container,
		svgfile: iconMapping[item.phase as 'Sapphire' | 'Ruby' | 'Emerald'][gem_data],
		svgStyle: 'height: 30px;',
		tooltipText: [`Max ${item.phase}`, `Rank ${gem_data}`],
		tooltipStyle: 'translate: -25px 15px; width: 60px;',
	});
}

async function badgeNocts(container: Element, item: CSFloat.Item) {
	const nocts_data = NoctsMapping[item.paint_seed!];
	if (!nocts_data) return;

	const iconMapping = {
		1: ICON_NOCTS_1,
		2: ICON_NOCTS_2,
		3: ICON_NOCTS_3,
	};

	CSFloatHelpers.addPatternBadge({
		container,
		svgfile: iconMapping[nocts_data],
		svgStyle: 'height: 30px;',
		tooltipText: ['Max Black', `Tier ${nocts_data}`],
		tooltipStyle: 'translate: -25px 15px; width: 60px;',
	});
}

function badgeCharm(container: Element, item: CSFloat.Item) {
	const pattern = item.keychain_pattern;
	if (!pattern) return;

	const badgeProps = getCharmColoring(pattern, item.item_name);

	const badgeContainer = container.querySelector<HTMLDivElement>('.keychain-pattern');
	if (!badgeContainer) return;

	badgeContainer.style.backgroundColor = badgeProps[0] + '80';
	(<HTMLSpanElement>badgeContainer.firstElementChild).style.color = badgeProps[1];
}

async function badgeDiamondGem(container: Element, item: CSFloat.Item) {
	const diamondGem_data = DiamonGemMapping[item.paint_seed!];
	if (!diamondGem_data) return;

	const iconMapping = {
		1: ICON_DIAMOND_GEM_1,
		2: ICON_DIAMOND_GEM_2,
		3: ICON_DIAMOND_GEM_3,
	};

	CSFloatHelpers.addPatternBadge({
		container,
		svgfile: iconMapping[diamondGem_data.tier],
		svgStyle: 'height: 30px;',
		tooltipText: ['Diamond Gem', `Rank ${diamondGem_data.rank} (T${diamondGem_data.tier})`, `Blue: ${diamondGem_data.blue}%`],
		tooltipStyle: 'translate: -40px 15px; width: 110px;',
	});
}

async function badgePinkGalaxy(container: Element, item: CSFloat.Item) {
	const pinkGalaxy_data = PinkGalaxyMapping[item.paint_seed!];
	if (!pinkGalaxy_data) return;

	const iconMapping = {
		1: ICON_PINK_GALAXY_1,
		2: ICON_PINK_GALAXY_2,
		3: ICON_PINK_GALAXY_3,
	};
	CSFloatHelpers.addPatternBadge({
		container,
		svgfile: iconMapping[pinkGalaxy_data],
		svgStyle: 'height: 30px;',
		tooltipText: ['Pink Galaxy', `Tier ${pinkGalaxy_data}`],
		tooltipStyle: 'translate: -25px 15px; width: 80px;',
	});
}

async function badgeOverprint(container: Element, item: CSFloat.Item) {
	const overprint_data = await OverprintMapping.getPattern(item.paint_seed!);
	if (!overprint_data) return;

	const getTooltipStyle = (type: typeof overprint_data.type) => {
		switch (type) {
			case 'Flower':
				return 'translate: -15px 15px; width: 55px;';
			case 'Arrow':
				return 'translate: -25px 15px; width: 100px;';
			case 'Polygon':
				return 'translate: -25px 15px; width: 100px;';
			case 'Mixed':
				return 'translate: -15px 15px; width: 55px;';
			default:
				return '';
		}
	};

	const badgeStyle = 'color: lightgrey; font-size: 18px; font-weight: 500;' + (overprint_data.type === 'Flower' ? ' margin-left: 5px;' : '');

	const iconMapping = {
		Flower: ICON_OVERPRINT_FLOWER,
		Arrow: ICON_OVERPRINT_ARROW,
		Polygon: ICON_OVERPRINT_POLYGON,
		Mixed: ICON_OVERPRINT_MIXED,
	};
	CSFloatHelpers.addPatternBadge({
		container,
		svgfile: iconMapping[overprint_data.type],
		svgStyle: 'height: 30px; filter: brightness(0) saturate(100%) invert(79%) sepia(65%) saturate(2680%) hue-rotate(125deg) brightness(95%) contrast(95%);',
		tooltipText: [`"${overprint_data.type}" Pattern`].concat(overprint_data.tier === 0 ? [] : [`Tier ${overprint_data.tier}`]),
		tooltipStyle: getTooltipStyle(overprint_data.type),
		badgeText: overprint_data.tier === 0 ? '' : 'T' + overprint_data.tier,
		badgeStyle,
	});
}

async function badgeCKimono(container: Element, item: CSFloat.Item) {
	const ck_data = await CrimsonKimonoMapping.getPattern(item.paint_seed!);
	if (!ck_data) return;

	const badgeStyle = 'color: lightgrey; font-size: 18px; font-weight: 500; position: absolute; top: 6px;';
	if (ck_data.tier === -1) {
		CSFloatHelpers.addPatternBadge({
			container,
			svgfile: ICON_CRIMSON,
			svgStyle: 'height: 30px; filter: grayscale(100%);',
			tooltipText: ['T1 GRAY PATTERN'],
			tooltipStyle: 'translate: -25px 15px; width: 80px;',
			badgeText: '1',
			badgeStyle,
		});
	} else {
		CSFloatHelpers.addPatternBadge({
			container,
			svgfile: ICON_CRIMSON,
			svgStyle: 'height: 30px;',
			tooltipText: [`Tier ${ck_data.tier}`],
			tooltipStyle: 'translate: -18px 15px; width: 60px;',
			badgeText: String(ck_data.tier),
			badgeStyle,
		});
	}
}

async function badgePhoenix(container: Element, item: CSFloat.Item) {
	const phoenix_data = await PhoenixMapping.getPattern(item.paint_seed!);
	if (!phoenix_data) return;

	CSFloatHelpers.addPatternBadge({
		container,
		svgfile: ICON_PHOENIX,
		svgStyle: 'height: 30px;',
		tooltipText: [`Position: ${phoenix_data.type}`, `Tier ${phoenix_data.tier}`].concat(phoenix_data.rank ? [`Rank #${phoenix_data.rank}`] : []),
		tooltipStyle: 'translate: -15px 15px; width: 90px;',
		badgeText: 'T' + phoenix_data.tier,
		badgeStyle: 'color: #d946ef; font-size: 18px; font-weight: 600;',
	});
}

async function webDetection(container: Element, item: CSFloat.Item) {
	let type = '';
	if (item.item_name.includes('Gloves')) {
		type = 'gloves';
	} else {
		type = item.item_name.split('★ ')[1].split(' ')[0].toLowerCase();
	}
	const cw_data = await getCrimsonWebMapping(type as Extension.CWWeaponTypes, item.paint_seed!);
	if (!cw_data) return;
	const itemImg = container.querySelector('.item-img');
	if (!itemImg) return;

	const filter = item.item_name.includes('Crimson')
		? 'brightness(0) saturate(100%) invert(13%) sepia(87%) saturate(576%) hue-rotate(317deg) brightness(93%) contrast(113%)'
		: 'brightness(0) saturate(100%) invert(64%) sepia(64%) saturate(2232%) hue-rotate(43deg) brightness(84%) contrast(90%)';

	CSFloatHelpers.addPatternBadge({
		container,
		svgfile: ICON_SPIDER_WEB,
		svgStyle: `height: 30px; filter: ${filter};`,
		tooltipText: [cw_data.type, `Tier ${cw_data.tier}`],
		tooltipStyle: 'translate: -25px 15px; width: 80px;',
		badgeText: cw_data.type === 'Triple Web' ? '3' : cw_data.type === 'Double Web' ? '2' : '1',
		badgeStyle: `color: ${item.item_name.includes('Crimson') ? 'lightgrey' : 'white'}; font-size: 18px; font-weight: 500; position: absolute; top: 7px;`,
	});
}

async function addCaseHardenedSales(item: CSFloat.Item) {
	if ((!item.item_name.includes('Case Hardened') && !item.item_name.includes('Heat Treated')) || item.item_name.includes('Gloves') || item.paint_seed === undefined) return;

	const userCurrency = CSFloatHelpers.userCurrency();
	const currencySymbol = getSymbolFromCurrency(userCurrency) ?? '$';
	const type = getBlueGemName(item.item_name);

	// past sales table
	const pastSales = await fetchBlueGemPastSales({ type, paint_seed: item.paint_seed!, currency: userCurrency });
	const gridHistory = document.querySelector('.grid-history');
	if (!gridHistory || !pastSales) return;
	const salesHeader = document.createElement('mat-button-toggle');
	salesHeader.setAttribute('role', 'presentation');
	salesHeader.className = 'mat-button-toggle mat-button-toggle-appearance-standard';
	salesHeader.innerHTML = `<button type="button" class="mat-button-toggle-button mat-focus-indicator" aria-pressed="false"><span class="mat-button-toggle-label-content" style="color: deepskyblue;">Buff Pattern Sales (${pastSales?.length})</span></button>`;
	gridHistory.querySelector('mat-button-toggle-group.sort')?.appendChild(salesHeader);
	salesHeader.addEventListener('click', () => {
		Array.from(gridHistory.querySelectorAll('mat-button-toggle') ?? []).forEach((element) => {
			element.className = element.className.replace('mat-button-toggle-checked', '');
		});
		salesHeader.className += ' mat-button-toggle-checked';

		const tableBody = document.createElement('tbody');
		pastSales.forEach((sale) => {
			const saleHtml = html`
				<tr role="row" class="mat-mdc-row mdc-data-table__row cdk-row" style="${item.float_value && new Decimal(sale.wear).toDP(10).equals(item.float_value.toFixed(10)) ? 'background-color: #0b255d;' : ''}">
					<td role="cell" class="mat-mdc-cell mdc-data-table__cell cdk-cell">
						<img src="${sale.origin === 'CSFloat' ? ICON_CSFLOAT : ICON_BUFF}" style="height: 28px; border: 1px solid dimgray; border-radius: 4px;" />
					</td>
					<td role="cell" class="mat-mdc-cell mdc-data-table__cell cdk-cell">${sale.date}</td>
					<td role="cell" class="mat-mdc-cell mdc-data-table__cell cdk-cell">${currencySymbol}${sale.price}</td>
					<td role="cell" class="mat-mdc-cell mdc-data-table__cell cdk-cell">
						${sale.type === 'stattrak' ? '<span style="color: rgb(255, 120, 44); margin-right: 5px;">StatTrak™</span>' : ''}
						<span>${sale.wear}</span>
					</td>
					<td role="cell" class="mat-mdc-cell">
						${
							sale.screenshots.inspect
								? html`
									<a href="${sale.screenshots.inspect}" target="_blank" title="Show Buff screenshot">
										<mat-icon role="img" class="mat-icon notranslate material-icons mat-ligature-font mat-icon-no-color">photo_camera</mat-icon>
									</a>
							  `
								: ''
						}
						${
							sale.screenshots.inspect_playside
								? html`
									<a href="${sale.screenshots.inspect_playside}" target="_blank" title="Show CSFloat font screenshot">
										<mat-icon role="img" class="mat-icon notranslate material-icons mat-ligature-font mat-icon-no-color">photo_camera</mat-icon>
									</a>
							  	`
								: ''
						}
						${
							sale.screenshots.inspect_backside
								? html`
									<a href="${sale.screenshots.inspect_backside}" target="_blank" title="Show CSFloat back screenshot">
										<img
											src="${ICON_CAMERA_FLIPPED}"
											style="height: 24px; translate: 7px 0; filter: brightness(0) saturate(100%) invert(39%) sepia(52%) saturate(4169%) hue-rotate(201deg) brightness(113%) contrast(101%);"
										/>
									</a>
								`
								: ''
						}
					</td>
				</tr>
			`;
			tableBody.insertAdjacentHTML('beforeend', saleHtml);
		});
		const outerContainer = document.createElement('div');
		outerContainer.setAttribute('style', 'width: 100%; height: 100%; padding: 10px; background-color: rgba(193, 206, 255, .04);border-radius: 6px; box-sizing: border-box;');
		const innerContainer = document.createElement('div');
		innerContainer.className = 'table-container slimmed-table';
		innerContainer.setAttribute('style', 'height: 100%;overflow-y: auto;overflow-x: hidden;overscroll-behavior: none;');
		const table = document.createElement('table');
		table.className = 'mat-mdc-table mdc-data-table__table cdk-table bf-table';
		table.setAttribute('role', 'table');
		table.setAttribute('style', 'width: 100%;');
		const header = document.createElement('thead');
		header.setAttribute('role', 'rowgroup');
		const tableTr = document.createElement('tr');
		tableTr.setAttribute('role', 'row');
		tableTr.className = 'mat-mdc-header-row mdc-data-table__header-row cdk-header-row ng-star-inserted';
		const headerValues = ['Source', 'Date', 'Price', 'Float Value'];
		for (let i = 0; i < headerValues.length; i++) {
			const headerCell = document.createElement('th');
			headerCell.setAttribute('role', 'columnheader');
			const headerCellStyle = `text-align: center; color: var(--subtext-color); letter-spacing: .03em; background: rgba(193, 206, 255, .04); ${
				i === 0 ? 'border-top-left-radius: 10px; border-bottom-left-radius: 10px' : ''
			}`;
			headerCell.setAttribute('style', headerCellStyle);
			headerCell.className = 'mat-mdc-header-cell mdc-data-table__header-cell ng-star-inserted';
			headerCell.textContent = headerValues[i];
			tableTr.appendChild(headerCell);
		}
		const linkHeaderCell = document.createElement('th');
		linkHeaderCell.setAttribute('role', 'columnheader');
		linkHeaderCell.setAttribute(
			'style',
			'text-align: center; color: var(--subtext-color); letter-spacing: .03em; background: rgba(193, 206, 255, .04); border-top-right-radius: 10px; border-bottom-right-radius: 10px'
		);
		linkHeaderCell.className = 'mat-mdc-header-cell mdc-data-table__header-cell ng-star-inserted';
		const linkHeader = document.createElement('a');
		linkHeader.setAttribute('href', `https://csbluegem.com/search?skin=${type}&pattern=${item.paint_seed}`);
		linkHeader.setAttribute('target', '_blank');
		linkHeader.innerHTML = ICON_ARROWUP_SMALL;
		linkHeaderCell.appendChild(linkHeader);
		tableTr.appendChild(linkHeaderCell);
		header.appendChild(tableTr);
		table.appendChild(header);
		table.appendChild(tableBody);
		innerContainer.appendChild(table);
		outerContainer.appendChild(innerContainer);

		const historyChild = gridHistory.querySelector('.history-component')?.firstElementChild;
		if (historyChild?.firstElementChild) {
			historyChild.removeChild(historyChild.firstElementChild);
			historyChild.appendChild(outerContainer);
		}
	});
}

function adjustExistingSP(container: Element) {
	const spContainer = container.querySelector('.sticker-percentage');
	let spValue = spContainer?.textContent!.trim().split('%')[0];
	if (!spValue || !spContainer) return;
	if (spValue.startsWith('>')) {
		spValue = spValue.substring(1);
	}
	const backgroundImageColor = getSPBackgroundColor(Number(spValue) / 100);
	(<HTMLElement>spContainer).style.backgroundColor = backgroundImageColor;
}

function addListingAge(container: Element, listing: CSFloat.ListingData, isPopout: boolean) {
	if ((isPopout && container.querySelector('.item-card.large .betterfloat-listing-age')) || (!isPopout && container.querySelector('.betterfloat-listing-age'))) {
		return;
	}

	const listingAge = html`
		<div class="betterfloat-listing-age hint--bottom hint--rounded hint--no-arrow" style="display: flex; align-items: flex-end;" aria-label="${new Date(listing.created_at).toLocaleString()}">
			<p style="margin: 0 5px 0 0; font-size: 13px; color: var(--subtext-color);">${calculateTime(calculateEpochFromDate(listing.created_at))}</p>
			<img src="${ICON_CLOCK}" style="height: 16px; filter: brightness(0) saturate(100%) invert(59%) sepia(55%) saturate(3028%) hue-rotate(340deg) brightness(101%) contrast(101%);" />
		</div>
	`;

	const parent = container.querySelector<HTMLElement>('.top-right-container');
	if (parent) {
		parent.style.flexDirection = 'column';
		parent.style.alignItems = 'flex-end';
		parent.insertAdjacentHTML('afterbegin', listingAge);
		const action = parent.querySelector('.action');
		if (action) {
			const newParent = document.createElement('div');
			newParent.style.display = 'inline-flex';
			newParent.style.justifyContent = 'flex-end';
			newParent.appendChild(action);
			parent.appendChild(newParent);
		}
	}

	// add selling date
	if (listing.state === 'sold' && listing.sold_at) {
		const sellingAge = calculateTime(calculateEpochFromDate(listing.sold_at));
		const statusButton = container.querySelector<HTMLElement>('.status-button');
		if (statusButton?.hasAttribute('disabled')) {
			const buttonLabel = statusButton.querySelector('span.mdc-button__label');
			if (buttonLabel) {
				buttonLabel.textContent = `Sold ${sellingAge} (${new Date(listing.sold_at).toLocaleString()})`;
			}
		}
	}
}

async function addStickerInfo(container: Element, apiItem: CSFloat.ListingData, price_difference: number) {
	if (!apiItem.item?.stickers) return;

	// quality 12 is souvenir
	if (apiItem.item?.quality === 12) {
		adjustExistingSP(container);
		addStickerLinks(container, apiItem.item);
		return;
	}

	let csfSP = container.querySelector('.sticker-percentage');
	if (!csfSP) {
		const newContainer = html`
			<div class="mat-mdc-tooltip-trigger sticker-percentage" style="padding: 5px;
				background-color: #0003;
				border-radius: 5px;
				width: -moz-fit-content;
				width: fit-content;
				font-size: 12px;
				margin-left: 8px;
				margin-bottom: 4px;">
			</div>
		`;
		container.querySelector('.sticker-container')?.insertAdjacentHTML('afterbegin', newContainer);
		csfSP = container.querySelector('.sticker-percentage');
	}
	if (csfSP) {
		let difference = price_difference;
		// auctions without a bid
		if (apiItem.price === apiItem.auction_details?.reserve_price && !apiItem.auction_details?.top_bid) {
			difference = new Decimal(apiItem.auction_details.reserve_price).div(100).plus(price_difference).toDP(2).toNumber();
		}
		const didChange = await changeSpContainer(csfSP, apiItem.item.stickers, difference);
		if (!didChange) {
			csfSP.remove();
		}
	}

	// add links to stickers
	addStickerLinks(container, apiItem.item);
}

// for stickers + charms
function addStickerLinks(container: Element, item: CSFloat.Item) {
	let data: CSFloat.StickerData[] = [];
	if (item.keychains) {
		data = data.concat(item.keychains);
	}
	if (item.stickers) {
		data = data.concat(item.stickers);
	}

	const stickerContainers = container.querySelectorAll('.sticker');
	for (let i = 0; i < stickerContainers.length; i++) {
		const stickerContainer = stickerContainers[i];
		const stickerData = data[i];
		if (!stickerData) continue;

		stickerContainer.addEventListener('click', async () => {
			const stickerURL = new URL('https://csfloat.com/search');
			stickerURL.searchParams.set(stickerData.pattern ? 'keychain_index' : 'sticker_index', String(stickerData.stickerId));

			window.open(stickerURL.href, '_blank');
		});
	}
}

// returns if the SP container was created, so priceSum >= 2
async function changeSpContainer(csfSP: Element, stickers: CSFloat.StickerData[], price_difference: number) {
	const source = extensionSettings['csf-pricingsource'] as MarketSource;
	const { userCurrency, currencyRate } = await getCurrencyRate();
	const stickerPrices = await Promise.all(
		stickers.map(async (s) => {
			if (!s.name) return { csf: 0, buff: 0 };

			const buffPrice = await getItemPrice(s.name, source);
			return {
				csf: (s.reference?.price ?? 0) / 100,
				buff: buffPrice.starting_at * currencyRate,
			};
		})
	);

	const priceSum = stickerPrices.reduce((a, b) => a + Math.min(b.buff, b.csf), 0);

	const spPercentage = new Decimal(price_difference).div(priceSum).toDP(4);
	// don't display SP if total price is below $1
	csfSP.setAttribute('data-betterfloat', JSON.stringify({ priceSum, spPercentage: spPercentage.toNumber() }));

	if (priceSum < 2) {
		return false;
	}

	if (spPercentage.gt(2) || spPercentage.lt(0.005) || location.pathname === '/sell') {
		const CurrencyFormatter = new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency: userCurrency,
			currencyDisplay: 'narrowSymbol',
			minimumFractionDigits: 0,
			maximumFractionDigits: 2,
		});
		csfSP.textContent = `${CurrencyFormatter.format(Number(priceSum.toFixed(0)))} SP`;
	} else {
		csfSP.textContent = (spPercentage.isPos() ? spPercentage.mul(100) : 0).toFixed(1) + '% SP';
	}
	if (location.pathname !== '/sell') {
		(<HTMLElement>csfSP).style.backgroundColor = getSPBackgroundColor(spPercentage.toNumber());
	}
	(<HTMLElement>csfSP).style.marginBottom = '5px';
	return true;
}

const parsePrice = (textContent: string) => {
	const regex = /([A-Za-z]+)\s+(\d+)/;
	const priceText = textContent.trim().replace(regex, '$1$2').split(/\s/);
	let price: number;
	let currency = '$';
	if (priceText.includes('Bids')) {
		price = 0;
	} else {
		try {
			let pricingText: string;
			if (location.pathname === '/sell') {
				pricingText = priceText[1].split('Price')[1] ?? '$ 0';
			} else {
				pricingText = priceText[0];
			}
			if (pricingText.split(/\s/).length > 1) {
				const parts = pricingText.replace(',', '').replace('.', '').split(/\s/);
				price = Number(parts.filter((x) => !Number.isNaN(+x)).join('')) / 100;
				currency = parts.filter((x) => Number.isNaN(+x))[0];
			} else {
				const firstDigit = Array.from(pricingText).findIndex((x) => !Number.isNaN(Number(x)));
				currency = pricingText.substring(0, firstDigit);
				price = Number(pricingText.substring(firstDigit).replace(',', '').replace('.', '')) / 100;
			}
		} catch (_e) {
			// happens when UI is not loaded yet so we can ignore it
			price = 0;
		}
	}
	return { price, currency };
};

function getFloatItem(container: Element): CSFloat.FloatItem {
	const nameContainer = container.querySelector('app-item-name');
	const priceContainer = container.querySelector('.price');
	const header_details = <Element>nameContainer?.querySelector('.subtext');

	const name = nameContainer?.querySelector('.item-name')?.textContent?.replace('\n', '').trim();
	// replace potential spaces between currency characters and price
	const { price } = parsePrice(priceContainer?.textContent ?? '');
	const float = Number(container.querySelector('item-float-bar .wear')?.textContent);
	let condition: ItemCondition | undefined;
	let quality = '';
	let style: ItemStyle = '';
	let isStatTrak = false;
	let isSouvenir = false;

	if (header_details) {
		let headerText = header_details.textContent?.trim() ?? '';

		// Check for StatTrak and Souvenir
		if (headerText.startsWith('StatTrak™')) {
			isStatTrak = true;
			headerText = headerText.replace('StatTrak™ ', '');
		}
		if (headerText.startsWith('Souvenir') && !headerText.startsWith('Souvenir Charm')) {
			isSouvenir = true;
			headerText = headerText.replace('Souvenir ', '');
		}

		const conditions: ItemCondition[] = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
		for (const cond of conditions) {
			if (headerText.includes(cond)) {
				condition = cond;
				headerText = headerText.replace(cond, '').trim();
				break;
			}
		}

		if (headerText.includes('(')) {
			style = headerText.substring(headerText.indexOf('(') + 1, headerText.lastIndexOf(')')) as DopplerPhase;
			headerText = headerText.replace(`(${style})`, '').trim();
		}

		// Remaining text is quality
		const qualityTypes = ['Container', 'Sticker', 'Agent', 'Patch', 'Charm', 'Collectible', 'Music Kit'];
		for (const qualityType of qualityTypes) {
			if (headerText.includes(qualityType)) {
				quality = headerText;
				break;
			}
		}
	}

	if (name?.includes('★') && !name?.includes('|')) {
		style = 'Vanilla';
	}

	return {
		name: name ?? '',
		quality: quality,
		style: style,
		condition: condition,
		float: float,
		price: price,
		isStatTrak,
		isSouvenir,
	};
}

async function getCurrencyRate() {
	const userCurrency = CSFloatHelpers.userCurrency();
	let currencyRate = await getCSFCurrencyRate(userCurrency);
	if (!currencyRate) {
		console.warn(`[BetterFloat] Could not get currency rate for ${userCurrency}`);
		currencyRate = 1;
	}
	return { userCurrency, currencyRate };
}

async function getBuffItem(item: CSFloat.FloatItem) {
	let source = extensionSettings['csf-pricingsource'] as MarketSource;
	const buff_name = handleSpecialStickerNames(createBuffName(item));
	const market_id: number | string | undefined = await getMarketID(buff_name, source);

	let pricingData = await getBuffPrice(buff_name, item.style, source);

	if (Object.keys(pricingData).length === 0 || (pricingData.priceListing?.isZero() && pricingData.priceOrder?.isZero())) {
		source = extensionSettings['csf-altmarket'] as MarketSource;
		if (source !== MarketSource.None) {
			pricingData = await getBuffPrice(buff_name, item.style, source);
		}
	}

	const { currencyRate } = await getCurrencyRate();

	const useOrderPrice =
		pricingData.priceOrder &&
		extensionSettings['csf-pricereference'] === 0 &&
		([MarketSource.Buff, MarketSource.Steam].includes(source) || (MarketSource.YouPin === source && isUserPro(extensionSettings['user'])));

	let priceFromReference = useOrderPrice ? pricingData.priceOrder : (pricingData.priceListing ?? new Decimal(0));

	priceFromReference = priceFromReference?.mul(currencyRate);

	return {
		buff_name: buff_name,
		market_id: market_id,
		priceListing: pricingData.priceListing?.mul(currencyRate),
		priceOrder: pricingData.priceOrder?.mul(currencyRate),
		priceFromReference,
		difference: new Decimal(item.price).minus(priceFromReference ?? 0),
		source,
	};
}

async function addBuffPrice(
	item: CSFloat.FloatItem,
	container: Element,
	popout: POPOUT_ITEM
): Promise<{
	price_difference: number;
	percentage: Decimal;
}> {
	const isSellTab = location.pathname === '/sell';
	const isPopout = popout === POPOUT_ITEM.PAGE;

	const priceContainer = container.querySelector<HTMLElement>(isSellTab ? '.price' : '.price-row');
	const userCurrency = CSFloatHelpers.userCurrency();
	const currencyFormatter = CurrencyFormatter(userCurrency);
	const isDoppler = item.name.includes('Doppler') && item.name.includes('|');

	const { buff_name, market_id, priceListing, priceOrder, priceFromReference, difference, source } = await getBuffItem(item);
	const itemExists =
		(source === MarketSource.Buff && (Number(market_id) > 0 || priceOrder?.gt(0))) ||
		source === MarketSource.Steam ||
		(source === MarketSource.C5Game && priceListing) ||
		(source === MarketSource.YouPin && priceListing) ||
		(source === MarketSource.CSFloat && priceListing) ||
		(source === MarketSource.CSMoney && priceListing);

	if (priceContainer && !container.querySelector('.betterfloat-buffprice') && popout !== POPOUT_ITEM.SIMILAR && itemExists) {
		const buffContainer = generatePriceLine({
			source,
			market_id,
			buff_name,
			priceOrder,
			priceListing,
			priceFromReference,
			userCurrency,
			itemStyle: item.style as DopplerPhase,
			CurrencyFormatter: currencyFormatter,
			isDoppler,
			isPopout,
			iconHeight: '20px',
			hasPro: isUserPro(extensionSettings['user']),
		});

		if (!container.querySelector('.betterfloat-buffprice')) {
			if (isSellTab) {
				priceContainer.outerHTML = buffContainer;
			} else {
				priceContainer.insertAdjacentHTML('afterend', buffContainer);
			}
		}
		if (isPopout) {
			container.querySelector('.betterfloat-big-price')?.setAttribute('data-betterfloat', JSON.stringify({ priceFromReference: priceFromReference?.toFixed(2) ?? 0, userCurrency }));
		}
	}

	// add link to steam market
	if ((extensionSettings['csf-steamsupplement'] || extensionSettings['csf-steamlink']) && buff_name && (!container.querySelector('.betterfloat-steamlink') || isPopout)) {
		const flexGrow = container.querySelector('div.seller-details > div');
		if (flexGrow) {
			let steamContainer = '';
			if (extensionSettings['csf-steamsupplement'] || isPopout) {
				const { priceListing } = await getBuffPrice(buff_name, item.style, MarketSource.Steam);
				if (priceListing?.gt(0)) {
					const { currencyRate } = await getCurrencyRate();
					const percentage = new Decimal(item.price).div(priceListing).div(currencyRate).times(100);

					if (percentage.gt(1)) {
						steamContainer = html`
							<a
								class="betterfloat-steamlink"
								href="https://steamcommunity.com/market/listings/730/${encodeURIComponent(buff_name)}"
								target="_blank"
								style="display: flex; align-items: center; gap: 4px; background: var(--highlight-background); border-radius: 20px; padding: 2px 6px; z-index: 10; translate: 0px 1px;"
							>
								<span style="color: cornflowerblue; margin-left: 2px; ${isPopout ? 'font-size: 15px; font-weight: 500;' : ' font-size: 13px;'}">${percentage.gt(300) ? '>300' : percentage.toFixed(percentage.gt(130) || percentage.lt(80) ? 0 : 1)}%</span>
								<div>
									<img src="${ICON_STEAM}" style="height: ${isPopout ? '18px' : '16px'}; translate: 0px 1px;"></img>
								</div>
							</a>
						`;
					}
				}
			}
			if (steamContainer === '') {
				steamContainer = html`
					<a class="betterfloat-steamlink" href="https://steamcommunity.com/market/listings/730/${encodeURIComponent(buff_name)}" target="_blank">
						<img src="${ICON_STEAM}" style="height: ${isPopout ? '18px' : '16px'}; translate: 0px 2px;" />
					</a>
				`;
			}
			flexGrow?.insertAdjacentHTML('afterend', steamContainer);
		}
	}

	const percentage = priceFromReference?.isPositive() ? new Decimal(item.price).div(priceFromReference).times(100) : new Decimal(0);

	// edge case handling: reference price may be a valid 0 for some paper stickers etc.
	if (
		(extensionSettings['csf-buffdifference'] || extensionSettings['csf-buffdifferencepercent']) &&
		!priceContainer?.querySelector('.betterfloat-sale-tag') &&
		item.price !== 0 &&
		(priceFromReference?.isPositive() || item.price < 0.06) &&
		(priceListing?.isPositive() || priceOrder?.isPositive()) &&
		location.pathname !== '/sell' &&
		itemExists
	) {
		const priceContainer = container.querySelector<HTMLElement>('.price-row');
		const priceIcon = priceContainer?.querySelector('app-price-icon');
		const floatAppraiser = priceContainer?.querySelector('.reference-widget-container');

		if (priceIcon) {
			priceContainer?.removeChild(priceIcon);
		}
		if (floatAppraiser && !isPopout) {
			priceContainer?.removeChild(floatAppraiser);
		}

		let backgroundColor: string;
		let differenceSymbol: string;
		if (difference.isNegative()) {
			backgroundColor = `light-dark(${extensionSettings['csf-color-profit']}80, ${extensionSettings['csf-color-profit']})`;
			differenceSymbol = '-';
		} else if (difference.isPos()) {
			backgroundColor = `light-dark(${extensionSettings['csf-color-loss']}80, ${extensionSettings['csf-color-loss']})`;
			differenceSymbol = '+';
		} else {
			backgroundColor = `light-dark(${extensionSettings['csf-color-neutral']}80, ${extensionSettings['csf-color-neutral']})`;
			differenceSymbol = '-';
		}

		const saleTag = document.createElement('span');
		saleTag.setAttribute('class', 'betterfloat-sale-tag');
		saleTag.style.backgroundColor = backgroundColor;
		saleTag.setAttribute('data-betterfloat', String(difference));
		// tags may get too long, so we may need to break them into two lines
		let saleTagInner = extensionSettings['csf-buffdifference'] || isPopout ? html`<span>${differenceSymbol}${currencyFormatter.format(difference.abs().toNumber())}</span>` : '';
		if ((extensionSettings['csf-buffdifferencepercent'] || isPopout) && priceFromReference) {
			if (percentage.isFinite()) {
				const percentageDecimalPlaces = percentage.toDP(percentage.greaterThan(200) ? 0 : percentage.greaterThan(150) ? 1 : 2).toNumber();
				saleTagInner += html`
					<span class="betterfloat-sale-tag-percentage" ${extensionSettings['csf-buffdifference'] || isPopout ? 'style="margin-left: 5px;"' : ''}> 
						${extensionSettings['csf-buffdifference'] || isPopout ? ` (${percentageDecimalPlaces}%)` : `${percentageDecimalPlaces}%`} 
					</span>
				`;
			}
		}
		saleTag.innerHTML = saleTagInner;

		if (isPopout && floatAppraiser) {
			priceContainer?.insertBefore(saleTag, floatAppraiser);
		} else {
			priceContainer?.appendChild(saleTag);
		}
		if ((item.price > 999 || (priceContainer?.textContent?.length ?? 0) > 24) && !isPopout) {
			saleTag.style.flexDirection = 'column';
			saleTag.querySelector('.betterfloat-sale-tag-percentage')?.setAttribute('style', 'margin-left: 0;');
		}
	}

	// add event listener to bargain button if it exists
	const bargainButton = container.querySelector<HTMLButtonElement>('button.mat-stroked-button');
	if (bargainButton && !bargainButton.disabled) {
		bargainButton.addEventListener('click', () => {
			setTimeout(() => {
				const listing = container.getAttribute('data-betterfloat');
				const bargainPopup = document.querySelector('app-make-offer-dialog');
				if (bargainPopup && listing) {
					bargainPopup.querySelector('item-card')?.setAttribute('data-betterfloat', listing);
				}
			}, 100);
		});
	}

	return {
		price_difference: difference.toNumber(),
		percentage,
	};
}

function createBuffName(item: CSFloat.FloatItem): string {
	let full_name = `${item.name}`;
	if (item.quality.includes('Sticker')) {
		full_name = 'Sticker | ' + full_name;
	} else if (item.quality.includes('Patch')) {
		full_name = 'Patch | ' + full_name;
	} else if (item.quality.includes('Charm')) {
		full_name = 'Charm | ' + full_name;
	} else if (item.quality.includes('Music Kit')) {
		full_name = 'Music Kit | ' + full_name;
		if (item.isStatTrak) {
			full_name = 'StatTrak™ ' + full_name;
		}
	} else if (!item.quality.includes('Container') && !item.quality.includes('Agent') && !item.quality.includes('Collectible')) {
		if (item.isSouvenir) {
			full_name = 'Souvenir ' + full_name;
		} else if (item.isStatTrak) {
			full_name = full_name.includes('★') ? full_name.replace('★', '★ StatTrak™') : `StatTrak™ ${full_name}`;
		}
		// fix name inconsistency
		if (item.name.endsWith('| 027')) {
			full_name = full_name.replace('027', '27');
		}
		if (item.style !== 'Vanilla') {
			full_name += ` (${item.condition})`;
		}
	}
	return full_name
		.replace(/ +(?= )/g, '')
		.replace(/\//g, '-')
		.trim();
}

const unsupportedSubPages = ['blog.csfloat', '/db'];

let extensionSettings: IStorage;
let ITEM_SCHEMA: CSFloat.ItemSchema.TypeSchema | null = null;
// mutation observer active?
let isObserverActive = false;
let refreshInterval: NodeJS.Timeout | null = null;

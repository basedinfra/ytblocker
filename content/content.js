(function () {
  "use strict";

  if (window.__ytbContentCleanup) {
    window.__ytbContentCleanup();
  }

  const SHORTS_SELECTORS = [
    "ytd-reel-shelf-renderer",
    "ytd-rich-section-renderer:has(ytd-reel-shelf-renderer)",
    "ytd-rich-item-renderer:has(a[href*='/shorts/'])",
    "ytd-video-renderer:has(a[href*='/shorts/'])",
    "ytd-compact-video-renderer:has(a[href*='/shorts/'])",
    "ytd-grid-video-renderer:has(a[href*='/shorts/'])",
    "ytd-reel-item-renderer",
    "ytm-shorts-lockup-view-model",
  ];

  const PLAYABLES_SELECTORS = [
    "ytd-rich-section-renderer:has([href*='/playables'])",
    "ytd-rich-item-renderer:has([href*='/playables'])",
    "ytd-rich-shelf-renderer:has([href*='/playables'])",
    "ytd-compact-video-renderer:has([href*='/playables'])",
  ];

  const VIDEO_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-compact-video-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "yt-lockup-view-model",
  ];

  const VIDEO_SELECTOR = VIDEO_SELECTORS.join(", ");

  const POPUP_SELECTORS =
    "tp-yt-iron-dropdown, ytd-popup-container, ytd-menu-popup-renderer, [role='listbox'], [role='menu'], .ytListItemViewModelInPopup";

  const MENU_ITEM_SELECTORS =
    "ytd-menu-service-item-renderer, tp-yt-paper-item, [role='menuitem'], [role='option'], .ytListItemViewModelContainer, .ytListItemViewModelButtonOrAnchor, a, button, li";

  // --- Page Type Detection ---

  function getPageType() {
    const path = location.pathname;
    if (path === "/" || path.startsWith("/feed/")) return "feed";
    if (path === "/results") return "search";
    if (path === "/watch") return "watch";
    return null;
  }

  let currentPageType = null;
  let scanIntervalId = null;
  let activeObserver = null;

  let settings = {
    shortsBlocked: true,
    playablesBlocked: true,
    primetimeBlocked: true,
    keywordDismissalEnabled: false,
    playlistDismissalEnabled: false,
    channelBlockingEnabled: false,
    dismissalDelayMinSeconds: 3,
    dismissalDelayMaxSeconds: 7,
    videoDurationMinSeconds: -1,
    videoDurationMaxSeconds: -1,
    videoAgeMinDays: -1,
    videoAgeMaxDays: -1,
    keywords: [],
    blockedChannels: [],
  };

  const DEFAULT_DISMISSAL_DELAY_MIN_SECONDS = 3;
  const DEFAULT_DISMISSAL_DELAY_MAX_SECONDS = 7;
  const DEFAULT_VIDEO_DURATION_MIN_SECONDS = -1;
  const DEFAULT_VIDEO_DURATION_MAX_SECONDS = -1;
  const DEFAULT_VIDEO_AGE_MIN_DAYS = -1;
  const DEFAULT_VIDEO_AGE_MAX_DAYS = -1;
  const MAX_FILTER_ACTIONS_PER_PAGE = 10;
  const SCROLL_RESTORE_SETTLE_MS = 2000;
  const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"];
  const SCROLL_CONTAINER_SELECTORS = [
    "html",
    "body",
    "ytd-app",
    "ytd-page-manager",
    "#page-manager",
    "ytd-browse",
    "ytd-watch-flexy",
    "#contents",
  ];

  let dismissalQueue = [];
  let queuedVideoElements = new Set();
  let isProcessingQueue = false;
  let dismissalTimerId = null;
  let pageFilterActionCount = 0;
  let dismissalBudgetLogged = false;
  let blockedPlaylistIds = new Set();

  // --- Shared Helpers ---

  function getVideoTitle(videoEl) {
    const titleEl = videoEl.querySelector("#video-title")
      || videoEl.querySelector("h3[title]")
      || videoEl.querySelector("a.yt-lockup-metadata-view-model__title")
      || videoEl.querySelector(".ytLockupMetadataViewModelTitle");
    if (!titleEl) return "";
    return titleEl.getAttribute("title")
      || titleEl.getAttribute("aria-label")
      || titleEl.textContent.trim()
      || "";
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function getElementLabel(el) {
    return normalizeText(
      el.getAttribute("title")
        || el.getAttribute("aria-label")
        || el.textContent
        || ""
    );
  }

  function getChannelTexts(videoEl) {
    const channelTexts = [];
    const channelSelectors = [
      "ytd-channel-name a",
      "#channel-name a",
      "#byline a",
      "a.yt-simple-endpoint[href^='/@']",
      "a.yt-simple-endpoint[href^='/channel/']",
      "a.yt-simple-endpoint[href^='/c/']",
      "yt-content-metadata-view-model a[href^='/@']",
      "a.yt-lockup-metadata-view-model__metadata[href^='/@']",
    ];

    channelSelectors.forEach((selector) => {
      videoEl.querySelectorAll(selector).forEach((el) => {
        const label = getElementLabel(el);
        if (label) channelTexts.push(label);
      });
    });

    const metadataRow = videoEl.querySelector(".ytContentMetadataViewModelMetadataRow")
      || videoEl.querySelector("yt-content-metadata-view-model [role='group']");
    if (metadataRow) {
      const label = getElementLabel(metadataRow);
      if (label) channelTexts.push(label);
    }

    return [...new Set(channelTexts)];
  }

  // --- Settings ---

  function applyToggleClasses() {
    document.documentElement.classList.toggle(
      "ytb-hide-shorts",
      settings.shortsBlocked
    );
    document.documentElement.classList.toggle(
      "ytb-hide-playables",
      settings.playablesBlocked
    );
  }

  function loadSettings() {
    chrome.storage.sync.get(
      {
        shortsBlocked: true,
        playablesBlocked: true,
        primetimeBlocked: true,
        keywordDismissalEnabled: false,
        playlistDismissalEnabled: false,
        channelBlockingEnabled: false,
        dismissalDelayMinSeconds: DEFAULT_DISMISSAL_DELAY_MIN_SECONDS,
        dismissalDelayMaxSeconds: DEFAULT_DISMISSAL_DELAY_MAX_SECONDS,
        videoDurationMinSeconds: DEFAULT_VIDEO_DURATION_MIN_SECONDS,
        videoDurationMaxSeconds: DEFAULT_VIDEO_DURATION_MAX_SECONDS,
        videoAgeMinDays: DEFAULT_VIDEO_AGE_MIN_DAYS,
        videoAgeMaxDays: DEFAULT_VIDEO_AGE_MAX_DAYS,
        keywords: [],
        blockedChannels: [],
      },
      (result) => {
        settings = result;
        console.log("[YTBlocker] Settings loaded:", JSON.stringify({
          keywordDismissalEnabled: settings.keywordDismissalEnabled,
          playlistDismissalEnabled: settings.playlistDismissalEnabled,
          channelBlockingEnabled: settings.channelBlockingEnabled,
          dismissalDelayMinSeconds: settings.dismissalDelayMinSeconds,
          dismissalDelayMaxSeconds: settings.dismissalDelayMaxSeconds,
          videoDurationMinSeconds: settings.videoDurationMinSeconds,
          videoDurationMaxSeconds: settings.videoDurationMaxSeconds,
          videoAgeMinDays: settings.videoAgeMinDays,
          videoAgeMaxDays: settings.videoAgeMaxDays,
          keywords: settings.keywords,
          blockedChannels: settings.blockedChannels,
        }));
        applyToggleClasses();
        if (currentPageType !== null) {
          runAllScans();
        }
      }
    );
  }

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) {
      settings[key] = newValue;
    }
    applyToggleClasses();
    if (currentPageType === null) return;

    if (
      "keywords" in changes ||
      "keywordDismissalEnabled" in changes ||
      "blockedChannels" in changes ||
      "channelBlockingEnabled" in changes ||
      "playlistDismissalEnabled" in changes ||
      "videoDurationMinSeconds" in changes ||
      "videoDurationMaxSeconds" in changes ||
      "videoAgeMinDays" in changes ||
      "videoAgeMaxDays" in changes
    ) {
      resetDismissalQueue(true);
      if (
        ("keywordDismissalEnabled" in changes && !settings.keywordDismissalEnabled) ||
        "keywords" in changes ||
        ("channelBlockingEnabled" in changes && !settings.channelBlockingEnabled) ||
        "blockedChannels" in changes
      ) {
        document.querySelectorAll(VIDEO_SELECTOR).forEach((el) => {
          if (isRemovedVideoNotice(el)) return;
          el.style.opacity = "";
          el.style.pointerEvents = "";
        });
      }
      document.querySelectorAll(VIDEO_SELECTOR).forEach((el) => {
        if (isRemovedVideoNotice(el)) return;
        delete el.dataset.ytbScanned;
        delete el.dataset.ytbChannelScanned;
        delete el.dataset.ytbPlaylistScanned;
        delete el.dataset.ytbDurationScanned;
        delete el.dataset.ytbAgeScanned;
      });
      runAllScans();
    }

    if ("primetimeBlocked" in changes && currentPageType === "feed") {
      scanForPrimetimeMovies();
    }
  });

  // --- DOM Removal ---

  function removeMatchingElements() {
    // Shorts and Playables are hidden by content.css. Avoid removing them from
    // the live feed because YouTube may change scroll anchors during reloads.
  }

  // --- Keyword Matching ---

  function getMatchingTextListItem(text, list, enabled) {
    if (!enabled || list.length === 0) {
      return null;
    }
    return list.find((item) => {
      if (item.caseSensitive) {
        return text.includes(item.text);
      }
      return text.toLowerCase().includes(item.text.toLowerCase());
    }) || null;
  }

  function getMatchingKeywordText(title) {
    const keyword = getMatchingTextListItem(
      title,
      settings.keywords,
      settings.keywordDismissalEnabled
    );
    return keyword ? keyword.text : "";
  }

  function normalizeMatchText(text) {
    return text
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesChannelText(channelText, blockedChannel) {
    if (blockedChannel.caseSensitive) {
      return channelText.includes(blockedChannel.text);
    }

    const normalizedChannelText = normalizeMatchText(channelText);
    const normalizedBlockedChannel = normalizeMatchText(blockedChannel.text);
    if (!normalizedBlockedChannel) return false;

    return (
      channelText.toLowerCase().includes(blockedChannel.text.toLowerCase()) ||
      normalizedChannelText.includes(normalizedBlockedChannel)
    );
  }

  function getMatchingChannelFilterText(channelTexts) {
    if (!settings.channelBlockingEnabled || settings.blockedChannels.length === 0) {
      return "";
    }

    for (const channelText of channelTexts) {
      const blockedChannel = settings.blockedChannels.find((candidate) =>
        matchesChannelText(channelText, candidate)
      );
      if (blockedChannel) return blockedChannel.text;
    }

    return "";
  }

  function isElementInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth
    );
  }

  function isRemovedVideoNotice(el) {
    return el.dataset.ytbRemoved === "true";
  }

  function describeFilterMatch(filterType, filterText) {
    const normalizedFilterType = normalizeText(String(filterType || "Filter"));
    const normalizedFilterText = normalizeText(String(filterText || "matched rule"));
    return normalizedFilterType + ": " + normalizedFilterText;
  }

  function renderRemovedVideoNotice(videoEl, filterDescription) {
    if (!videoEl || !videoEl.isConnected || videoEl.dataset.ytbRemoved === "true") {
      return;
    }

    const title = getVideoTitle(videoEl);
    const notice = document.createElement("div");
    notice.className = "ytb-removed-video-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");

    const heading = document.createElement("div");
    heading.className = "ytb-removed-video-notice__heading";
    heading.textContent = "Video removed by YTBlocker";

    const filter = document.createElement("div");
    filter.className = "ytb-removed-video-notice__filter";
    filter.textContent = "Filtered by: " + normalizeText(filterDescription || "matched rule");

    notice.append(heading, filter);

    if (title) {
      const titleLine = document.createElement("div");
      titleLine.className = "ytb-removed-video-notice__title";
      titleLine.textContent = title;
      notice.appendChild(titleLine);
    }

    videoEl.dataset.ytbRemoved = "true";
    videoEl.textContent = "";
    videoEl.appendChild(notice);
    videoEl.style.opacity = "";
    videoEl.style.pointerEvents = "";
    videoEl.removeAttribute("href");
  }

  function enqueueVideoMatch(videoEl, matchType, matchedText) {
    const filterDescription = describeFilterMatch(matchType, matchedText);
    console.log("[YTBlocker] " + matchType + " match:", matchedText);
    if (currentPageType === "search") {
      // On search pages, avoid dismissal clicks because YouTube can navigate
      // away. Keep a visible in-page removal notice instead.
      enqueueFilterAction(videoEl, "remove", 0, { filterDescription });
    } else if (currentPageType === "watch") {
      // Watch sidebar matching is hide-only because dismissal clicks can
      // navigate the main player. Still render the standard removed-video HTML.
      enqueueFilterAction(videoEl, "hide", 0, { filterDescription });
    } else if (!isElementInViewport(videoEl)) {
      // Offscreen menu clicks are what cause YouTube to snap the viewport to
      // newly-loaded matches. Keep those background mutations DOM-only.
      enqueueFilterAction(videoEl, "remove", 0, { filterDescription });
    } else {
      enqueueFilterAction(videoEl, "dismiss", 0, { filterDescription });
    }
  }

  function scanForKeywordMatches() {
    if (!settings.keywordDismissalEnabled || settings.keywords.length === 0) {
      return;
    }

    const allVideos = document.querySelectorAll(VIDEO_SELECTOR);
    let scannedCount = 0;
    let newCount = 0;
    let matched = false;

    allVideos.forEach((el) => {
      if (isRemovedVideoNotice(el)) return;
      if (el.dataset.ytbScanned) { scannedCount++; return; }

      const title = getVideoTitle(el);
      if (!title) return;

      newCount++;
      el.dataset.ytbScanned = "true";

      const matchingKeywordText = getMatchingKeywordText(title);
      if (matchingKeywordText) {
        enqueueVideoMatch(el, "Keyword", matchingKeywordText);
        matched = true;
      }
    });

    if (matched) processQueue();

    if (newCount > 0) {
      console.log("[YTBlocker] Scan: total=" + allVideos.length + " alreadyScanned=" + scannedCount + " new=" + newCount + " queueSize=" + dismissalQueue.length);
    }
  }

  // --- Channel Matching ---

  function scanForChannelMatches() {
    if (
      !settings.channelBlockingEnabled ||
      settings.blockedChannels.length === 0
    ) {
      return;
    }

    const allVideos = document.querySelectorAll(VIDEO_SELECTOR);
    let scannedCount = 0;
    let newCount = 0;
    let matched = false;

    allVideos.forEach((el) => {
      if (isRemovedVideoNotice(el)) return;
      if (el.dataset.ytbChannelScanned) { scannedCount++; return; }

      const channelTexts = getChannelTexts(el);
      if (channelTexts.length === 0) return;

      newCount++;
      el.dataset.ytbChannelScanned = "true";

      const matchingChannelFilterText = getMatchingChannelFilterText(channelTexts);
      if (matchingChannelFilterText) {
        enqueueVideoMatch(el, "Channel", matchingChannelFilterText);
        matched = true;
      }
    });

    if (matched) processQueue();

    if (newCount > 0) {
      console.log("[YTBlocker] Channel scan: total=" + allVideos.length + " alreadyScanned=" + scannedCount + " new=" + newCount + " queueSize=" + dismissalQueue.length);
    }
  }

  // --- Duration Matching ---

  function normalizeDurationBound(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return -1;
    return Math.round(number);
  }

  function hasDurationFilterEnabled() {
    return (
      normalizeDurationBound(settings.videoDurationMinSeconds) >= 0 ||
      normalizeDurationBound(settings.videoDurationMaxSeconds) >= 0
    );
  }

  function parseClockDuration(text) {
    const match = String(text).match(/\b\d+(?::\d{1,2}){1,2}\b/);
    if (!match) return null;

    const parts = match[0].split(":").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.slice(1).some((part) => part > 59)) return null;

    return parts.reduce((total, part) => (total * 60) + part, 0);
  }

  function parseDurationLabel(label) {
    const text = String(label).toLowerCase();
    if (/\b(ago|views?|subscribers?|watching)\b/.test(text)) return null;

    const units = {
      hour: 3600,
      hours: 3600,
      minute: 60,
      minutes: 60,
      second: 1,
      seconds: 1,
    };
    let totalSeconds = 0;
    let matched = false;
    const pattern = /(\d+)\s*(hours?|minutes?|seconds?)/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      totalSeconds += Number.parseInt(match[1], 10) * units[match[2]];
      matched = true;
    }

    return matched ? totalSeconds : null;
  }

  function getVideoDurationSeconds(videoEl) {
    const durationSelectors = [
      "ytd-thumbnail-overlay-time-status-renderer #text",
      "ytd-thumbnail-overlay-time-status-renderer",
      "ytm-thumbnail-overlay-time-status-renderer",
      ".badge-shape-wiz__text",
      ".yt-badge-shape__text",
      ".ytThumbnailOverlayTimeStatusRendererHost",
    ];

    for (const selector of durationSelectors) {
      const durationEl = videoEl.querySelector(selector);
      if (!durationEl) continue;

      const clockDurationSeconds = parseClockDuration(durationEl.textContent);
      if (clockDurationSeconds !== null) return clockDurationSeconds;

      const durationSeconds = parseDurationLabel(
        durationEl.getAttribute("aria-label") || ""
      );
      if (durationSeconds !== null) return durationSeconds;
    }

    const ariaDurationEls = videoEl.querySelectorAll("[aria-label]");
    for (const el of ariaDurationEls) {
      const durationSeconds = parseDurationLabel(
        el.getAttribute("aria-label") || ""
      );
      if (durationSeconds !== null) return durationSeconds;
    }

    return parseClockDuration(videoEl.textContent);
  }

  function formatSecondsForNotice(totalSeconds) {
    const seconds = Math.round(totalSeconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours > 0) {
      return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
    }
    return minutes + ":" + String(remainder).padStart(2, "0");
  }

  function describeDurationFilter(durationSeconds) {
    const minSeconds = normalizeDurationBound(settings.videoDurationMinSeconds);
    const maxSeconds = normalizeDurationBound(settings.videoDurationMaxSeconds);
    const bounds = [];
    if (minSeconds >= 0) bounds.push("min " + formatSecondsForNotice(minSeconds));
    if (maxSeconds >= 0) bounds.push("max " + formatSecondsForNotice(maxSeconds));
    return "Duration " + bounds.join(", ") + " (video " + formatSecondsForNotice(durationSeconds) + ")";
  }

  function isDurationWithinBounds(durationSeconds) {
    const minSeconds = normalizeDurationBound(settings.videoDurationMinSeconds);
    const maxSeconds = normalizeDurationBound(settings.videoDurationMaxSeconds);

    if (minSeconds >= 0 && durationSeconds < minSeconds) return false;
    if (maxSeconds >= 0 && durationSeconds > maxSeconds) return false;
    return true;
  }

  function scanForDurationMatches() {
    if (!hasDurationFilterEnabled()) return;

    const allVideos = document.querySelectorAll(VIDEO_SELECTOR);
    let scannedCount = 0;
    let queuedCount = 0;

    allVideos.forEach((el) => {
      if (isRemovedVideoNotice(el)) return;
      if (el.dataset.ytbDurationScanned) { scannedCount++; return; }

      const durationSeconds = getVideoDurationSeconds(el);
      if (durationSeconds === null) return;

      el.dataset.ytbDurationScanned = "true";

      if (!isDurationWithinBounds(durationSeconds)) {
        console.log(
          "[YTBlocker] Duration match queued:",
          getVideoTitle(el) || "(unknown)",
          "durationSeconds=" + durationSeconds
        );
        enqueueFilterAction(el, "remove", 0, {
          filterDescription: describeDurationFilter(durationSeconds),
        });
        queuedCount++;
      }
    });

    if (queuedCount > 0) {
      console.log(
        "[YTBlocker] Duration scan: total=" +
          allVideos.length +
          " alreadyScanned=" +
          scannedCount +
          " queued=" +
          queuedCount
      );
      processQueue();
    }
  }

  // --- Creation Date Matching ---

  function normalizeAgeBound(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return -1;
    return number;
  }

  function hasAgeFilterEnabled() {
    return (
      normalizeAgeBound(settings.videoAgeMinDays) >= 0 ||
      normalizeAgeBound(settings.videoAgeMaxDays) >= 0
    );
  }

  function parseVideoAgeLabel(label) {
    const text = normalizeText(String(label).toLowerCase());
    if (!text) return null;
    if (/\btoday\b/.test(text)) return 0;
    if (/\byesterday\b/.test(text)) return 1;

    const match = text.match(
      /\b(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week|month|year)s?\s+ago\b/
    );
    if (!match) return null;

    const amount = Number(match[1]);
    const units = {
      second: 1 / 86400,
      minute: 1 / 1440,
      hour: 1 / 24,
      day: 1,
      week: 7,
      month: 30,
      year: 365,
    };

    return amount * units[match[2]];
  }

  function getVideoAgeDays(videoEl) {
    const ageSelectors = [
      "#metadata-line span",
      "ytd-video-meta-block span",
      "yt-content-metadata-view-model span",
      ".inline-metadata-item",
      ".yt-lockup-metadata-view-model__metadata",
      ".ytContentMetadataViewModelMetadataRow span",
    ];

    for (const selector of ageSelectors) {
      const ageEls = videoEl.querySelectorAll(selector);
      for (const ageEl of ageEls) {
        const ageDays = parseVideoAgeLabel(getElementLabel(ageEl));
        if (ageDays !== null) return ageDays;
      }
    }

    const ariaEls = videoEl.querySelectorAll("[aria-label]");
    for (const el of ariaEls) {
      const ageDays = parseVideoAgeLabel(el.getAttribute("aria-label") || "");
      if (ageDays !== null) return ageDays;
    }

    return parseVideoAgeLabel(videoEl.textContent);
  }

  function formatDaysForNotice(days) {
    const roundedDays = Math.round(days * 10) / 10;
    if (roundedDays < 1) return "less than 1 day";
    if (roundedDays === 1) return "1 day";
    return roundedDays + " days";
  }

  function describeAgeFilter(ageDays) {
    const minDays = normalizeAgeBound(settings.videoAgeMinDays);
    const maxDays = normalizeAgeBound(settings.videoAgeMaxDays);
    const bounds = [];
    if (minDays >= 0) bounds.push("min " + formatDaysForNotice(minDays));
    if (maxDays >= 0) bounds.push("max " + formatDaysForNotice(maxDays));
    return "Creation date " + bounds.join(", ") + " (video age " + formatDaysForNotice(ageDays) + ")";
  }

  function isAgeWithinBounds(ageDays) {
    const minDays = normalizeAgeBound(settings.videoAgeMinDays);
    const maxDays = normalizeAgeBound(settings.videoAgeMaxDays);

    if (minDays >= 0 && ageDays < minDays) return false;
    if (maxDays >= 0 && ageDays > maxDays) return false;
    return true;
  }

  function scanForAgeMatches() {
    if (!hasAgeFilterEnabled()) return;

    const allVideos = document.querySelectorAll(VIDEO_SELECTOR);
    let scannedCount = 0;
    let queuedCount = 0;

    allVideos.forEach((el) => {
      if (isRemovedVideoNotice(el)) return;
      if (el.dataset.ytbAgeScanned) { scannedCount++; return; }

      const ageDays = getVideoAgeDays(el);
      if (ageDays === null) return;

      el.dataset.ytbAgeScanned = "true";

      if (!isAgeWithinBounds(ageDays)) {
        console.log(
          "[YTBlocker] Creation date match queued:",
          getVideoTitle(el) || "(unknown)",
          "ageDays=" + ageDays
        );
        enqueueFilterAction(el, "remove", 0, {
          filterDescription: describeAgeFilter(ageDays),
        });
        queuedCount++;
      }
    });

    if (queuedCount > 0) {
      console.log(
        "[YTBlocker] Creation date scan: total=" +
          allVideos.length +
          " alreadyScanned=" +
          scannedCount +
          " queued=" +
          queuedCount
      );
      processQueue();
    }
  }

  // --- Playlist Matching ---

  function getPlaylistId(videoEl) {
    const playlistLink = videoEl.querySelector(
      "a[href*='list='], a[href^='/playlist?list=']"
    );
    if (playlistLink) {
      try {
        const url = new URL(playlistLink.getAttribute("href"), location.origin);
        const listId = url.searchParams.get("list");
        if (listId) return listId;
      } catch (e) {
        // Fall back to class parsing below.
      }
    }

    const contentIdEl = videoEl.querySelector("[class*='content-id-']");
    if (!contentIdEl) return "";

    const contentIdClass = [...contentIdEl.classList].find((className) =>
      className.startsWith("content-id-")
    );
    return contentIdClass ? contentIdClass.slice("content-id-".length) : "";
  }

  function getPlaylistItemCount(videoEl) {
    const playlistLinks = videoEl.querySelectorAll(
      "a[href*='list='], a[href^='/playlist?list=']"
    );
    if (playlistLinks.length === 0) return 0;

    const countMatch = videoEl.textContent.match(
      /\b([\d,]+)\s+(videos?|episodes?)\b/i
    );
    if (!countMatch) return 0;

    return Number.parseInt(countMatch[1].replace(/,/g, ""), 10) || 0;
  }

  function hasPlaylistLink(videoEl) {
    return Boolean(
      videoEl.querySelector("a[href*='list='], a[href^='/playlist?list=']")
    );
  }

  function hasPlaylistCardStructure(videoEl) {
    if (
      videoEl.querySelector(
        "yt-collection-thumbnail-view-model, yt-collections-stack, [class*='ytLockupViewModelCollectionStack'], [class*='content-id-PL']"
      )
    ) {
      return true;
    }

    return /\bview full (playlist|podcast)\b/i.test(videoEl.textContent);
  }

  function shouldBlockPlaylist(videoEl) {
    if (!hasPlaylistLink(videoEl)) return false;

    const playlistCount = getPlaylistItemCount(videoEl);
    if (playlistCount > 1) return true;

    return hasPlaylistCardStructure(videoEl);
  }

  function scanForPlaylistMatches() {
    if (!settings.playlistDismissalEnabled) return;

    const allVideos = document.querySelectorAll(VIDEO_SELECTOR);
    let candidateCount = 0;
    let matched = false;

    allVideos.forEach((el) => {
      if (isRemovedVideoNotice(el)) return;
      if (el.dataset.ytbPlaylistScanned) return;

      const playlistId = getPlaylistId(el);
      if (playlistId || hasPlaylistLink(el)) {
        candidateCount++;
      }

      if (playlistId && blockedPlaylistIds.has(playlistId)) {
        console.log("[YTBlocker] Reinserted playlist queued for removal:", playlistId);
        el.dataset.ytbPlaylistScanned = "true";
        enqueueFilterAction(el, "remove", 0, {
          playlistId,
          filterDescription: describeFilterMatch("Playlist", playlistId || "previously blocked playlist"),
        });
        matched = true;
        return;
      }

      const playlistCount = getPlaylistItemCount(el);
      if (!shouldBlockPlaylist(el)) return;

      el.dataset.ytbPlaylistScanned = "true";

      console.log(
        "[YTBlocker] Playlist match queued:",
        getVideoTitle(el),
        "items=" + (playlistCount || "unknown"),
        "id=" + (playlistId || "(unknown)")
      );
      const playlistFilterDescription = describeFilterMatch(
        "Playlist",
        playlistId || getVideoTitle(el) || "playlist card"
      );
      if (!isElementInViewport(el)) {
        if (playlistId) {
          blockedPlaylistIds.add(playlistId);
        }
        enqueueFilterAction(el, "remove", 0, {
          playlistId,
          filterDescription: playlistFilterDescription,
        });
      } else {
        enqueueFilterAction(el, "block-playlist", 0, {
          playlistId,
          filterDescription: playlistFilterDescription,
        });
      }
      matched = true;
    });

    if (candidateCount > 0) {
      console.log(
        "[YTBlocker] Playlist scan: candidates=" +
          candidateCount +
          " queueSize=" +
          dismissalQueue.length
      );
    }

    if (matched) processQueue();
  }

  // --- Primetime Movies Blocking ---

  const PRIMETIME_SHELF_SELECTORS = [
    "ytd-rich-shelf-renderer",
    "ytd-rich-section-renderer",
    "ytd-shelf-renderer",
  ];

  const PRIMETIME_SHELF_SELECTOR = PRIMETIME_SHELF_SELECTORS.join(", ");
  const PRIMETIME_BLOCKED_ATTR = "data-ytb-primetime-blocked";

  function isPrimetimeShelf(el) {
    const titleEl =
      el.querySelector("#title-text") ||
      el.querySelector("[id='title'] yt-formatted-string") ||
      el.querySelector("#title");
    if (!titleEl) return false;
    return titleEl.textContent.trim().toLowerCase().includes("primetime");
  }

  function blockPrimetimeShelf(shelf) {
    shelf.setAttribute(PRIMETIME_BLOCKED_ATTR, "true");
    shelf.style.opacity = "";
    shelf.style.pointerEvents = "";
  }

  function clearPrimetimeShelfBlock(shelf) {
    shelf.removeAttribute(PRIMETIME_BLOCKED_ATTR);
    delete shelf.dataset.ytbPrimetimeScanned;
    shelf.style.opacity = "";
    shelf.style.pointerEvents = "";
  }

  function clearPrimetimeShelfBlocks() {
    document.querySelectorAll(PRIMETIME_SHELF_SELECTOR).forEach((shelf) => {
      if (
        shelf.hasAttribute(PRIMETIME_BLOCKED_ATTR) ||
        (shelf.style.opacity === "0" && shelf.style.pointerEvents === "none")
      ) {
        clearPrimetimeShelfBlock(shelf);
      }
    });
  }

  function scanForPrimetimeMovies() {
    if (!settings.primetimeBlocked) {
      clearPrimetimeShelfBlocks();
      return;
    }

    const shelves = document.querySelectorAll(PRIMETIME_SHELF_SELECTOR);

    for (const shelf of shelves) {
      if (shelf.style.opacity === "0" && shelf.style.pointerEvents === "none") {
        blockPrimetimeShelf(shelf);
      }

      if (shelf.dataset.ytbPrimetimeScanned) continue;
      if (!isPrimetimeShelf(shelf)) {
        // Only skip future scans if the title element exists (i.e. loaded but not primetime).
        // If title hasn't loaded yet, leave unmarked so we re-check later.
        const titleEl = shelf.querySelector("#title-text")
          || shelf.querySelector("[id='title'] yt-formatted-string")
          || shelf.querySelector("#title");
        if (titleEl && titleEl.textContent.trim()) {
          shelf.dataset.ytbPrimetimeScanned = "true";
        }
        continue;
      }
      shelf.dataset.ytbPrimetimeScanned = "true";

      console.log("[YTBlocker] Primetime shelf hidden");
      blockPrimetimeShelf(shelf);
    }
  }

  // --- "Not Interested" Dismissal Queue ---

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function clampDelaySeconds(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, 1), 120);
  }

  function randomDelay() {
    const minSeconds = clampDelaySeconds(
      settings.dismissalDelayMinSeconds,
      DEFAULT_DISMISSAL_DELAY_MIN_SECONDS
    );
    const maxSeconds = clampDelaySeconds(
      settings.dismissalDelayMaxSeconds,
      DEFAULT_DISMISSAL_DELAY_MAX_SECONDS
    );
    const minDelay = Math.min(minSeconds, maxSeconds) * 1000;
    const maxDelay = Math.max(minSeconds, maxSeconds) * 1000;

    return randomBetween(minDelay, maxDelay);
  }

  function hasQueuedWorkEnabled() {
    return (
      settings.keywordDismissalEnabled ||
      settings.channelBlockingEnabled ||
      settings.playlistDismissalEnabled ||
      hasDurationFilterEnabled() ||
      hasAgeFilterEnabled()
    );
  }

  function resetDismissalQueue(resetPageBudget = false) {
    dismissalQueue.length = 0;
    queuedVideoElements.clear();
    isProcessingQueue = false;
    dismissalBudgetLogged = false;

    if (dismissalTimerId !== null) {
      clearTimeout(dismissalTimerId);
      dismissalTimerId = null;
    }

    if (resetPageBudget) {
      pageFilterActionCount = 0;
      blockedPlaylistIds.clear();
    }
  }

  function hasDismissalBudget() {
    return (
      pageFilterActionCount + dismissalQueue.length < MAX_FILTER_ACTIONS_PER_PAGE
    );
  }

  function enqueueFilterAction(videoEl, action, retries = 0, metadata = {}) {
    if (queuedVideoElements.has(videoEl)) return;

    if (!hasDismissalBudget()) {
      if (!dismissalBudgetLogged) {
        console.log(
          "[YTBlocker] Filter action budget reached for this page. Additional matching videos will be left visible."
        );
        dismissalBudgetLogged = true;
      }
      return;
    }

    queuedVideoElements.add(videoEl);
    dismissalQueue.push({ el: videoEl, action, retries, metadata });
    console.log(
      "[YTBlocker] Queue add: action=" + action + " size=" + dismissalQueue.length
    );
  }

  function waitForElement(parent, selector, timeout = 3000) {
    return new Promise((resolve) => {
      const existing = parent.querySelector(selector);
      if (existing) return resolve(existing);

      let timeoutId;
      const observer = new MutationObserver(() => {
        const el = parent.querySelector(selector);
        if (el) {
          clearTimeout(timeoutId);
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(parent, { childList: true, subtree: true });

      timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function findNotInterestedItem() {
    const popups = document.querySelectorAll(POPUP_SELECTORS);
    for (const popup of popups) {
      if (popup.getAttribute("aria-hidden") === "true") continue;
      // opacity:0 elements (from ytb-dismissing) still have offsetParent, so this works
      if (getComputedStyle(popup).display === "none") continue;

      const candidates = [
        ...(popup.matches(MENU_ITEM_SELECTORS) ? [popup] : []),
        ...popup.querySelectorAll(MENU_ITEM_SELECTORS),
      ];
      for (const item of candidates) {
        if (item.textContent.trim().toLowerCase().includes("not interested")) {
          return getMenuItemClickTarget(item);
        }
      }
    }
    return null;
  }

  function getMenuItemClickTarget(item) {
    const clickable = item.querySelector(
      "button, a, [role='menuitem'], [role='option']"
    );
    return clickable || item;
  }

  function waitForNotInterestedItem(timeout = 2500) {
    return new Promise((resolve) => {
      const existing = findNotInterestedItem();
      if (existing) return resolve(existing);

      let timeoutId = null;
      const observer = new MutationObserver(() => {
        const item = findNotInterestedItem();
        if (!item) return;

        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(item);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(findNotInterestedItem());
      }, timeout);
    });
  }

  function getPopupMenuText() {
    const popups = document.querySelectorAll(POPUP_SELECTORS);
    const texts = [];
    for (const popup of popups) {
      if (popup.getAttribute("aria-hidden") === "true") continue;
      const items = [
        ...(popup.matches(MENU_ITEM_SELECTORS) ? [popup] : []),
        ...popup.querySelectorAll(MENU_ITEM_SELECTORS),
      ];
      items.forEach((i) => texts.push(i.textContent.trim()));
    }
    return texts;
  }

  function closePopup() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.click();
  }

  function getScrollingElement() {
    return document.scrollingElement || document.documentElement;
  }

  function isScrollableElement(el) {
    if (!el || el === window || el.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
  }

  function collectScrollTargets(anchorEl = null) {
    const targets = new Set([
      getScrollingElement(),
      document.documentElement,
      document.body,
    ]);

    SCROLL_CONTAINER_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => targets.add(el));
    });

    for (let el = anchorEl; el; el = el.parentElement) {
      if (isScrollableElement(el)) {
        targets.add(el);
      }
    }

    return [...targets].filter(Boolean);
  }

  function readScrollSnapshot(anchorEl = null) {
    return {
      windowX: window.scrollX,
      windowY: window.scrollY,
      targets: collectScrollTargets(anchorEl).map((el) => ({
        el,
        left: el.scrollLeft,
        top: el.scrollTop,
      })),
    };
  }

  function createScrollPreserver(anchorEl = null) {
    const position = readScrollSnapshot(anchorEl);
    const listenerOptions = { capture: true, passive: true };
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const originalFocus = HTMLElement.prototype.focus;
    const originalScrollTo = window.scrollTo;
    const originalScrollBy = window.scrollBy;
    let userInteracted = false;
    let isRestoring = false;
    let restoreFrameId = null;
    let patchedScrollIntoView = false;
    let patchedFocus = false;
    let patchedScrollTo = false;
    let patchedScrollBy = false;

    function restorePosition() {
      if (userInteracted) return;
      isRestoring = true;
      originalScrollTo.call(window, position.windowX, position.windowY);
      position.targets.forEach(({ el, left, top }) => {
        if (!el.isConnected && el !== document.body && el !== document.documentElement) {
          return;
        }
        el.scrollLeft = left;
        el.scrollTop = top;
      });
      requestAnimationFrame(() => {
        isRestoring = false;
      });
    }

    function scheduleScrollRestore() {
      if (userInteracted || isRestoring || restoreFrameId !== null) return;
      restoreFrameId = requestAnimationFrame(() => {
        restoreFrameId = null;
        restorePosition();
      });
    }

    const markUserInteracted = (event) => {
      if (event && event.isTrusted === false) return;
      userInteracted = true;
    };

    document.documentElement.classList.add("ytb-preserve-scroll");

    USER_SCROLL_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markUserInteracted, listenerOptions);
    });
    window.addEventListener("scroll", scheduleScrollRestore, listenerOptions);
    position.targets.forEach(({ el }) => {
      el.addEventListener("scroll", scheduleScrollRestore, listenerOptions);
    });

    try {
      Element.prototype.scrollIntoView = function (...args) {
        if (!userInteracted) return undefined;
        return originalScrollIntoView.apply(this, args);
      };
      patchedScrollIntoView = true;
    } catch (e) {
      console.log("[YTBlocker] Scroll preservation: unable to patch scrollIntoView", e);
    }

    try {
      HTMLElement.prototype.focus = function (options) {
        if (userInteracted) {
          return originalFocus.apply(this, arguments);
        }

        const focusOptions = options && typeof options === "object"
          ? { ...options, preventScroll: true }
          : { preventScroll: true };
        try {
          return originalFocus.call(this, focusOptions);
        } catch (e) {
          return originalFocus.apply(this, arguments);
        }
      };
      patchedFocus = true;
    } catch (e) {
      console.log("[YTBlocker] Scroll preservation: unable to patch focus", e);
    }

    try {
      window.scrollTo = function (...args) {
        if (!userInteracted) return undefined;
        return originalScrollTo.apply(window, args);
      };
      patchedScrollTo = true;
    } catch (e) {
      console.log("[YTBlocker] Scroll preservation: unable to patch scrollTo", e);
    }

    try {
      window.scrollBy = function (...args) {
        if (!userInteracted) return undefined;
        return originalScrollBy.apply(window, args);
      };
      patchedScrollBy = true;
    } catch (e) {
      console.log("[YTBlocker] Scroll preservation: unable to patch scrollBy", e);
    }

    return {
      restore() {
        restorePosition();
      },
      release() {
        if (restoreFrameId !== null) {
          cancelAnimationFrame(restoreFrameId);
        }
        document.documentElement.classList.remove("ytb-preserve-scroll");
        USER_SCROLL_EVENTS.forEach((eventName) => {
          window.removeEventListener(eventName, markUserInteracted, listenerOptions);
        });
        window.removeEventListener("scroll", scheduleScrollRestore, listenerOptions);
        position.targets.forEach(({ el }) => {
          el.removeEventListener("scroll", scheduleScrollRestore, listenerOptions);
        });
        if (patchedScrollIntoView) {
          Element.prototype.scrollIntoView = originalScrollIntoView;
        }
        if (patchedFocus) {
          HTMLElement.prototype.focus = originalFocus;
        }
        if (patchedScrollTo) {
          window.scrollTo = originalScrollTo;
        }
        if (patchedScrollBy) {
          window.scrollBy = originalScrollBy;
        }
      },
    };
  }

  async function withScrollPreserved(action, anchorEl = null) {
    const preserver = createScrollPreserver(anchorEl);

    try {
      const result = await action(() => preserver.restore());
      preserver.restore();
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          preserver.restore();
          resolve();
        });
      });
      await new Promise((resolve) => setTimeout(resolve, SCROLL_RESTORE_SETTLE_MS));
      preserver.restore();
      return result;
    } finally {
      preserver.release();
    }
  }

  async function clickNotInterested(videoEl, restoreScroll = () => {}) {
    const title = getVideoTitle(videoEl) || "(unknown)";
    const projection = projectElementIntoViewport(videoEl);

    try {
      // Hover to trigger lazy rendering of the menu button
      videoEl.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, composed: true })
      );
      videoEl.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, composed: true })
      );
      restoreScroll();

      const menuButton = await waitForElement(
        videoEl,
        "button[aria-label='More actions'], button[aria-label='Action menu'], ytd-menu-renderer button, yt-icon-button.dropdown-trigger",
        2000
      );
      if (!menuButton) {
        console.log("[YTBlocker] FAIL: menu button not found for:", title);
        return false;
      }

      console.log("[YTBlocker] Opening menu for:", title);
      document.documentElement.classList.add("ytb-dismissing");
      menuButton.click();
      restoreScroll();

      await new Promise((r) => setTimeout(r, 500));
      restoreScroll();

      const notInterestedItem = await waitForNotInterestedItem();

      if (!notInterestedItem) {
        const allPopupText = getPopupMenuText();
        console.log("[YTBlocker] FAIL: 'Not interested' not found. Visible menu text:", allPopupText);
        closePopup();
        restoreScroll();
        document.documentElement.classList.remove("ytb-dismissing");
        return false;
      }

      console.log("[YTBlocker] DISMISSED:", title);
      console.log("[YTBlocker] Clicking menu item:", notInterestedItem.tagName);
      notInterestedItem.click();
      restoreScroll();
      document.documentElement.classList.remove("ytb-dismissing");
      return true;
    } catch (e) {
      console.log("[YTBlocker] FAIL: error for:", title, e);
      closePopup();
      restoreScroll();
      document.documentElement.classList.remove("ytb-dismissing");
      return false;
    } finally {
      projection.release();
      restoreScroll();
    }
  }

  async function dismissVideo(videoEl) {
    return withScrollPreserved(
      (restoreScroll) => clickNotInterested(videoEl, restoreScroll),
      videoEl
    );
  }

  function projectElementIntoViewport(el) {
    const rect = el.getBoundingClientRect();
    const margin = 24;
    const isInViewport =
      rect.bottom > margin &&
      rect.top < window.innerHeight - margin &&
      rect.right > margin &&
      rect.left < window.innerWidth - margin;

    if (isInViewport) {
      return { release() {} };
    }

    const previous = {
      transform: el.style.transform,
      transformOrigin: el.style.transformOrigin,
      zIndex: el.style.zIndex,
      opacity: el.style.opacity,
      pointerEvents: el.style.pointerEvents,
      willChange: el.style.willChange,
    };
    const targetTop = Math.min(
      Math.max(margin, window.innerHeight / 3),
      Math.max(margin, window.innerHeight - Math.min(rect.height, 120) - margin)
    );
    const targetLeft = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - Math.min(rect.width, 320) - margin)
    );
    const deltaX = targetLeft - rect.left;
    const deltaY = targetTop - rect.top;
    const existingTransform = previous.transform || "";

    el.style.transform = `translate(${deltaX}px, ${deltaY}px) ${existingTransform}`;
    el.style.transformOrigin = "top left";
    el.style.zIndex = "-1";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    el.style.willChange = "transform";

    return {
      release() {
        el.style.transform = previous.transform;
        el.style.transformOrigin = previous.transformOrigin;
        el.style.zIndex = previous.zIndex;
        el.style.opacity = previous.opacity;
        el.style.pointerEvents = previous.pointerEvents;
        el.style.willChange = previous.willChange;
      },
    };
  }

  // Keep every queued video filter mutation here so background filtering does
  // not move the user's viewport as YouTube menus and cards change.
  async function performQueuedFilterAction(videoEl, action, metadata) {
    return withScrollPreserved(async (restoreScroll) => {
      if (action === "remove" || action === "hide") {
        renderRemovedVideoNotice(videoEl, metadata.filterDescription);
        restoreScroll();
        return true;
      }

      if (action === "block-playlist") {
        if (metadata.playlistId) {
          blockedPlaylistIds.add(metadata.playlistId);
        }

        const success = await clickNotInterested(videoEl, restoreScroll);
        if (videoEl.isConnected) {
          console.log(
            "[YTBlocker] Showing playlist removal notice after dismissal attempt. id=" +
              (metadata.playlistId || "(unknown)") +
              " notInterestedClicked=" +
              success
          );
          renderRemovedVideoNotice(videoEl, metadata.filterDescription);
          restoreScroll();
        }
        return success;
      }

      const success = await clickNotInterested(videoEl, restoreScroll);
      if (success && videoEl.isConnected) {
        renderRemovedVideoNotice(videoEl, metadata.filterDescription);
        restoreScroll();
      }
      return success;
    }, videoEl);
  }

  const MAX_RETRIES = 2;

  function processQueue() {
    if (isProcessingQueue || dismissalQueue.length === 0) return;
    if (document.hidden) return;
    if (!hasQueuedWorkEnabled()) return;
    if (pageFilterActionCount >= MAX_FILTER_ACTIONS_PER_PAGE) {
      resetDismissalQueue(false);
      return;
    }

    isProcessingQueue = true;
    scheduleNextDismissal(randomDelay());

    async function processNext() {
      dismissalTimerId = null;

      if (
        dismissalQueue.length === 0 ||
        document.hidden ||
        !hasQueuedWorkEnabled()
      ) {
        isProcessingQueue = false;
        return;
      }

      if (pageFilterActionCount >= MAX_FILTER_ACTIONS_PER_PAGE) {
        resetDismissalQueue(false);
        return;
      }

      const { el: videoEl, action, retries, metadata } = dismissalQueue.shift();
      queuedVideoElements.delete(videoEl);

      if (videoEl.isConnected) {
        pageFilterActionCount++;

        const success = await performQueuedFilterAction(
          videoEl,
          action,
          metadata || {}
        );
        if (
          !success &&
          action !== "remove" &&
          action !== "hide" &&
          action !== "block-playlist" &&
          retries < MAX_RETRIES
        ) {
          enqueueFilterAction(videoEl, action, retries + 1, metadata);
        }
      }

      if (dismissalQueue.length === 0) {
        isProcessingQueue = false;
        return;
      }

      scheduleNextDismissal(randomDelay());
    }

    function scheduleNextDismissal(delay) {
      dismissalTimerId = setTimeout(processNext, delay);
    }
  }

  function handleVisibilityChange() {
    if (!document.hidden && dismissalQueue.length > 0 && !isProcessingQueue) {
      processQueue();
    }
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);

  // --- MutationObserver ---

  function runAllScans() {
    removeMatchingElements();
    scanForDurationMatches();
    scanForAgeMatches();
    scanForKeywordMatches();
    scanForChannelMatches();
    scanForPlaylistMatches();
    if (currentPageType === "feed") {
      scanForPrimetimeMovies();
    }
  }

  let debounceTimer = null;

  function onMutation() {
    if (currentPageType === null) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runAllScans, 200);
  }

  function init() {
    loadSettings();

    if (document.body) {
      startObserver();
    } else {
      document.addEventListener("DOMContentLoaded", startObserver, { once: true });
    }
  }

  function onNavigate() {
    currentPageType = getPageType();
    console.log("[YTBlocker] Page type:", currentPageType);

    clearInterval(scanIntervalId);
    scanIntervalId = null;
    clearTimeout(debounceTimer);
    resetDismissalQueue(true);

    if (currentPageType !== null) {
      // Reset scan markers — new page has new content
      document.querySelectorAll(VIDEO_SELECTOR).forEach((el) => {
        if (isRemovedVideoNotice(el)) return;
        delete el.dataset.ytbScanned;
        delete el.dataset.ytbChannelScanned;
        delete el.dataset.ytbPlaylistScanned;
        delete el.dataset.ytbDurationScanned;
        delete el.dataset.ytbAgeScanned;
      });
      document.querySelectorAll(PRIMETIME_SHELF_SELECTOR).forEach((el) => {
        delete el.dataset.ytbPrimetimeScanned;
      });
      runAllScans();
      scanIntervalId = setInterval(runAllScans, 2000);
    }
  }

  function startObserver() {
    if (activeObserver) {
      activeObserver.disconnect();
    }

    activeObserver = new MutationObserver(onMutation);
    activeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    document.addEventListener("yt-navigate-finish", onNavigate);
    onNavigate();
  }

  window.__ytbContentCleanup = function () {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
    clearTimeout(debounceTimer);
    resetDismissalQueue(true);
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    document.removeEventListener("yt-navigate-finish", onNavigate);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("DOMContentLoaded", startObserver);
  };

  init();
})();

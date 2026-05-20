(function () {
  "use strict";

  const shortsToggle = document.getElementById("shortsToggle");
  const playablesToggle = document.getElementById("playablesToggle");
  const primetimeToggle = document.getElementById("primetimeToggle");
  const keywordDismissalToggle = document.getElementById(
    "keywordDismissalToggle"
  );
  const channelBlockingToggle = document.getElementById(
    "channelBlockingToggle"
  );
  const playlistDismissalToggle = document.getElementById(
    "playlistDismissalToggle"
  );
  const keywordInput = document.getElementById("keywordInput");
  const addKeywordBtn = document.getElementById("addKeyword");
  const keywordList = document.getElementById("keywordList");
  const channelInput = document.getElementById("channelInput");
  const addChannelBtn = document.getElementById("addChannel");
  const channelList = document.getElementById("channelList");
  const delayMinInput = document.getElementById("delayMinInput");
  const delayMaxInput = document.getElementById("delayMaxInput");
  const durationMinInput = document.getElementById("durationMinInput");
  const durationMaxInput = document.getElementById("durationMaxInput");
  const ageMinInput = document.getElementById("ageMinInput");
  const ageMaxInput = document.getElementById("ageMaxInput");
  const tabButtons = document.querySelectorAll(".tab");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const deleteRangeInfoToggle = document.getElementById(
    "deleteRangeInfoToggle"
  );
  const deleteRangeInfo = document.getElementById("deleteRangeInfo");

  let keywords = [];
  let blockedChannels = [];

  // --- Load Settings ---

  chrome.storage.sync.get(
    {
      shortsBlocked: true,
      playablesBlocked: true,
      primetimeBlocked: true,
      keywordDismissalEnabled: false,
      channelBlockingEnabled: false,
      playlistDismissalEnabled: false,
      dismissalDelayMinSeconds: 3,
      dismissalDelayMaxSeconds: 7,
      videoDurationMinSeconds: -1,
      videoDurationMaxSeconds: -1,
      videoAgeMinDays: -1,
      videoAgeMaxDays: -1,
      keywords: [],
      blockedChannels: [],
    },
    (result) => {
      shortsToggle.checked = result.shortsBlocked;
      playablesToggle.checked = result.playablesBlocked;
      primetimeToggle.checked = result.primetimeBlocked;
      keywordDismissalToggle.checked = result.keywordDismissalEnabled;
      channelBlockingToggle.checked = result.channelBlockingEnabled;
      playlistDismissalToggle.checked = result.playlistDismissalEnabled;
      delayMinInput.value = result.dismissalDelayMinSeconds;
      delayMaxInput.value = result.dismissalDelayMaxSeconds;
      durationMinInput.value = formatDurationSetting(
        result.videoDurationMinSeconds
      );
      durationMaxInput.value = formatDurationSetting(
        result.videoDurationMaxSeconds
      );
      ageMinInput.value = formatAgeSetting(result.videoAgeMinDays);
      ageMaxInput.value = formatAgeSetting(result.videoAgeMaxDays);
      keywords = result.keywords;
      blockedChannels = result.blockedChannels;
      renderKeywords();
      renderChannels();
    }
  );

  // --- Toggle Handlers ---

  function activateTab(tabId) {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === tabId;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.id === tabId;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
    });
  }

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tab);
    });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      const tabs = [...tabButtons];
      const direction = e.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (tabs.indexOf(button) + direction + tabs.length) %
        tabs.length;
      tabs[nextIndex].focus();
      activateTab(tabs[nextIndex].dataset.tab);
    });
  });

  function setDeleteRangeInfoOpen(isOpen) {
    deleteRangeInfo.hidden = !isOpen;
    deleteRangeInfoToggle.setAttribute("aria-expanded", String(isOpen));
  }

  deleteRangeInfoToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setDeleteRangeInfoOpen(deleteRangeInfo.hidden);
  });

  document.addEventListener("click", (e) => {
    if (deleteRangeInfo.hidden) return;
    if (
      deleteRangeInfo.contains(e.target) ||
      deleteRangeInfoToggle.contains(e.target)
    ) {
      return;
    }

    setDeleteRangeInfoOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setDeleteRangeInfoOpen(false);
    }
  });

  shortsToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ shortsBlocked: shortsToggle.checked });
  });

  playablesToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ playablesBlocked: playablesToggle.checked });
  });

  primetimeToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ primetimeBlocked: primetimeToggle.checked });
  });

  keywordDismissalToggle.addEventListener("change", () => {
    chrome.storage.sync.set({
      keywordDismissalEnabled: keywordDismissalToggle.checked,
    });
  });

  channelBlockingToggle.addEventListener("change", () => {
    chrome.storage.sync.set({
      channelBlockingEnabled: channelBlockingToggle.checked,
    });
  });

  playlistDismissalToggle.addEventListener("change", () => {
    chrome.storage.sync.set({
      playlistDismissalEnabled: playlistDismissalToggle.checked,
    });
  });

  function clampDelay(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.round(number), 1), 120);
  }

  function saveDelaySettings(changedInput) {
    let minSeconds = clampDelay(delayMinInput.value, 3);
    let maxSeconds = clampDelay(delayMaxInput.value, 7);

    if (minSeconds > maxSeconds) {
      if (changedInput === delayMinInput) {
        maxSeconds = minSeconds;
      } else {
        minSeconds = maxSeconds;
      }
    }

    delayMinInput.value = minSeconds;
    delayMaxInput.value = maxSeconds;
    chrome.storage.sync.set({
      dismissalDelayMinSeconds: minSeconds,
      dismissalDelayMaxSeconds: maxSeconds,
    });
  }

  delayMinInput.addEventListener("change", () => {
    saveDelaySettings(delayMinInput);
  });
  delayMaxInput.addEventListener("change", () => {
    saveDelaySettings(delayMaxInput);
  });

  function parseClockDuration(text) {
    if (!/^\d+(?::\d{1,2}){1,2}$/.test(text)) return null;

    const parts = text.split(":").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.slice(1).some((part) => part > 59)) return null;

    return parts.reduce((total, part) => (total * 60) + part, 0);
  }

  function parseDurationInput(value, fallback) {
    const text = String(value).trim().toLowerCase();
    if (!text || text === "any") return -1;

    const number = Number(text);
    if (Number.isFinite(number)) {
      return number < 0 ? -1 : Math.round(number);
    }

    const clockDuration = parseClockDuration(text);
    if (clockDuration !== null) return clockDuration;

    return fallback;
  }

  function formatDurationSetting(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return "any";

    const roundedSeconds = Math.max(Math.round(seconds), 0);
    let remainingSeconds = roundedSeconds;
    const hours = Math.floor(remainingSeconds / 3600);
    remainingSeconds %= 3600;
    const minutes = Math.floor(remainingSeconds / 60);
    const finalSeconds = remainingSeconds % 60;

    if (hours > 0) {
      return [
        String(hours),
        String(minutes).padStart(2, "0"),
        String(finalSeconds).padStart(2, "0"),
      ].join(":");
    }

    return [
      String(minutes),
      String(finalSeconds).padStart(2, "0"),
    ].join(":");
  }

  function saveDurationSettings(changedInput) {
    let minSeconds = parseDurationInput(durationMinInput.value, -1);
    let maxSeconds = parseDurationInput(durationMaxInput.value, -1);

    if (minSeconds >= 0 && maxSeconds >= 0 && minSeconds > maxSeconds) {
      if (changedInput === durationMinInput) {
        maxSeconds = minSeconds;
      } else {
        minSeconds = maxSeconds;
      }
    }

    durationMinInput.value = formatDurationSetting(minSeconds);
    durationMaxInput.value = formatDurationSetting(maxSeconds);
    chrome.storage.sync.set({
      videoDurationMinSeconds: minSeconds,
      videoDurationMaxSeconds: maxSeconds,
    });
  }

  durationMinInput.addEventListener("change", () => {
    saveDurationSettings(durationMinInput);
  });
  durationMaxInput.addEventListener("change", () => {
    saveDurationSettings(durationMaxInput);
  });

  function parseAgeInput(value, fallback) {
    const text = String(value).trim().toLowerCase();
    if (!text || text === "any") return -1;

    const number = Number(text);
    if (Number.isFinite(number)) {
      return number < 0 ? -1 : number;
    }

    const match = text.match(
      /^(\d+(?:\.\d+)?)\s*(h|hour|hours|d|day|days|w|week|weeks|m|mo|month|months|y|year|years)$/
    );
    if (!match) return fallback;

    const amount = Number(match[1]);
    const units = {
      d: 1,
      day: 1,
      days: 1,
      h: 1 / 24,
      hour: 1 / 24,
      hours: 1 / 24,
      w: 7,
      week: 7,
      weeks: 7,
      m: 30,
      mo: 30,
      month: 30,
      months: 30,
      y: 365,
      year: 365,
      years: 365,
    };

    return amount * units[match[2]];
  }

  function formatAgeSetting(value) {
    const days = Number(value);
    if (!Number.isFinite(days) || days < 0) return "any";
    return String(Number(Math.max(days, 0).toFixed(4)));
  }

  function saveAgeSettings(changedInput) {
    let minDays = parseAgeInput(ageMinInput.value, -1);
    let maxDays = parseAgeInput(ageMaxInput.value, -1);

    if (minDays >= 0 && maxDays >= 0 && minDays > maxDays) {
      if (changedInput === ageMinInput) {
        maxDays = minDays;
      } else {
        minDays = maxDays;
      }
    }

    ageMinInput.value = formatAgeSetting(minDays);
    ageMaxInput.value = formatAgeSetting(maxDays);
    chrome.storage.sync.set({
      videoAgeMinDays: minDays,
      videoAgeMaxDays: maxDays,
    });
  }

  ageMinInput.addEventListener("change", () => {
    saveAgeSettings(ageMinInput);
  });
  ageMaxInput.addEventListener("change", () => {
    saveAgeSettings(ageMaxInput);
  });

  // --- List Management ---

  function saveList(storageKey, list) {
    chrome.storage.sync.set({ [storageKey]: list });
  }

  function renderList(listEl, list, save) {
    listEl.innerHTML = "";
    list.forEach((item, index) => {
      const li = document.createElement("li");

      const text = document.createElement("span");
      text.className = "kw-text";
      text.textContent = item.text;

      const caseBtn = document.createElement("button");
      caseBtn.className = "kw-case" + (item.caseSensitive ? " active" : "");
      caseBtn.textContent = item.caseSensitive ? "Aa" : "aa";
      caseBtn.title = item.caseSensitive ? "Case-sensitive" : "Case-insensitive";
      caseBtn.addEventListener("click", () => {
        list[index].caseSensitive = !list[index].caseSensitive;
        save();
        renderList(listEl, list, save);
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "kw-remove";
      removeBtn.textContent = "\u00d7";
      removeBtn.addEventListener("click", () => {
        list.splice(index, 1);
        save();
        renderList(listEl, list, save);
      });

      li.append(text, caseBtn, removeBtn);
      listEl.appendChild(li);
    });
  }

  function addListItem(inputEl, list, save, render) {
    const text = inputEl.value.trim();
    if (!text) return;
    if (list.some((item) => item.text === text)) return;

    list.push({ text, caseSensitive: false });
    inputEl.value = "";
    save();
    render();
  }

  function saveKeywords() {
    saveList("keywords", keywords);
  }

  function saveChannels() {
    saveList("blockedChannels", blockedChannels);
  }

  function renderKeywords() {
    renderList(keywordList, keywords, saveKeywords);
  }

  function renderChannels() {
    renderList(channelList, blockedChannels, saveChannels);
  }

  function addKeyword() {
    addListItem(keywordInput, keywords, saveKeywords, renderKeywords);
  }

  function addChannel() {
    addListItem(channelInput, blockedChannels, saveChannels, renderChannels);
  }

  addKeywordBtn.addEventListener("click", addKeyword);
  keywordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addKeyword();
  });
  addChannelBtn.addEventListener("click", addChannel);
  channelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addChannel();
  });
})();

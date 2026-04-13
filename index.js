import { saveSettingsDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";

const extensionName = "regex-manager-HogwartsDLC";

if (!window.RegexManagerData) {
  window.RegexManagerData = {
    packs: {},
    enabled: [],
    active: true
  };
}

jQuery(async () => {
  console.log("[Regex Manager] Запуск...");

  try {
    const settingsHtml = await $.get(`/scripts/extensions/third-party/${extensionName}/settings.html`);
    $("#extensions_settings2").append(settingsHtml);
    console.log("[Regex Manager] HTML загружен");

    if (extension_settings[extensionName]) {
      window.RegexManagerData.enabled = extension_settings[extensionName].enabled || [];
      window.RegexManagerData.active = extension_settings[extensionName].active !== false;
    }

    await loadRegexPacks();
    renderPackList();
    updateToggleButton();

    if (window.RegexManagerData.active) {
      for (const packId of window.RegexManagerData.enabled) {
        injectRegexPack(packId);
      }
    }

    $("#regex-manager-toggle").on("click", async function() {
      window.RegexManagerData.active = !window.RegexManagerData.active;

      if (window.RegexManagerData.active) {
        for (const packId of window.RegexManagerData.enabled) {
          injectRegexPack(packId);
        }
        toastr.success("Regex Manager включён");
      } else {
        for (const packId of window.RegexManagerData.enabled) {
          removeRegexPack(packId);
        }
        toastr.info("Regex Manager выключен");
      }

      updateToggleButton();
      saveSettings();

      const ctx = SillyTavern.getContext();
      if (ctx.reloadCurrentChat) {
        await ctx.reloadCurrentChat();
      }
    });

    $("#regex-manager-debug").on("click", function() {
      openDebugger();
    });

    console.log("[Regex Manager] Готово!");
  } catch (e) {
    console.error("[Regex Manager] Ошибка инициализации:", e);
  }
});

function updateToggleButton() {
  const btn = $("#regex-manager-toggle");
  if (window.RegexManagerData.active) {
    btn.html('<i class="fa-solid fa-power-off"></i> ВКЛ').removeClass("inactive").addClass("active");
  } else {
    btn.html('<i class="fa-solid fa-power-off"></i> ВЫКЛ').removeClass("active").addClass("inactive");
  }

  $("#regex-manager-list input[type=checkbox]").prop("disabled", !window.RegexManagerData.active);
}

async function openDebugger() {
  const packs = window.RegexManagerData.packs;
  const enabledPacks = window.RegexManagerData.enabled;

  let allScripts = [];
  for (const packId of enabledPacks) {
    const pack = packs[packId];
    if (pack) {
      allScripts = allScripts.concat(pack.scripts.map(s => ({...s, packName: pack.name})));
    }
  }

  const html = `
    <div class="regex-manager-debugger">
      <div class="debugger-section">
        <h4><i class="fa-solid fa-list"></i> Активные регексы (${allScripts.length})</h4>
        <div class="debugger-rules">
          ${allScripts.length === 0 ? '<div class="no-rules">Нет активных регексов</div>' :
            allScripts.map((s, i) => `
              <div class="debugger-rule">
                <span class="rule-num">${i + 1}</span>
                <span class="rule-name">${s.scriptName}</span>
                <code class="rule-regex">${escapeHtml(s.findRegex.substring(0, 40))}${s.findRegex.length > 40 ? '...' : ''}</code>
              </div>
            `).join('')
          }
        </div>
      </div>

      <div class="debugger-section">
        <h4><i class="fa-solid fa-vial"></i> Тест</h4>
        <textarea id="debug-input" class="text_pole" rows="4" placeholder="Вставь текст для теста..."></textarea>
        <div class="debugger-buttons">
          <button id="debug-run" class="menu_button"><i class="fa-solid fa-play"></i> Запустить</button>
          <select id="debug-render">
            <option value="text">Как текст</option>
            <option value="html">Как HTML</option>
          </select>
        </div>
      </div>

      <div class="debugger-section">
        <h4><i class="fa-solid fa-flag-checkered"></i> Результат</h4>
        <div id="debug-output" class="debugger-output"></div>
      </div>

      <div class="debugger-section">
        <h4><i class="fa-solid fa-shoe-prints"></i> Пошаговая трансформация</h4>
        <div id="debug-steps" class="debugger-steps"></div>
      </div>
    </div>
  `;

  const popup = $(html);

  popup.find("#debug-run").on("click", function() {
    const input = popup.find("#debug-input").val();
    const renderMode = popup.find("#debug-render").val();

    if (!input) {
      toastr.warning("Введи текст для теста");
      return;
    }

    let result = input;
    const steps = [];

    for (const script of allScripts) {
      const before = result;

      try {
        const match = script.findRegex.match(/^\/(.+)\/([gimsuy]*)$/);
        if (match) {
          const regex = new RegExp(match[1], match[2]);
          result = result.replace(regex, script.replaceString);

          if (before !== result) {
            steps.push({
              name: script.scriptName,
              regex: script.findRegex,
              changed: true
            });
          }
        }
      } catch (e) {
        steps.push({
          name: script.scriptName,
          regex: script.findRegex,
          error: e.message
        });
      }
    }

    const outputEl = popup.find("#debug-output");
    if (renderMode === "html") {
      outputEl.html(result);
    } else {
      outputEl.text(result);
    }

    const stepsEl = popup.find("#debug-steps");
    if (steps.length === 0) {
      stepsEl.html('<div class="no-changes">Ни один регекс не сработал</div>');
    } else {
      stepsEl.html(steps.map(s => `
        <div class="step ${s.error ? 'step-error' : 'step-ok'}">
          <span class="step-name">${s.name}</span>
          ${s.error ? `<span class="step-error-msg">Ошибка: ${s.error}</span>` : '<span class="step-ok-msg">✓ Сработал</span>'}
        </div>
      `).join(''));
    }
  });

  await callGenericPopup(popup, POPUP_TYPE.TEXT, '', { wide: true, large: true });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadRegexPacks() {
const packFiles = [
  "hide-reasoning",
  "html-vanisher",
  "braille-blank-jb",
  "clocks",
  "clocks-minimal",
  "phone (pc)",
  "diary-pc",
  "diary-mobile",
  "transitions",
  "music-player",
  "infoblock",
  "infoblock-mobile",
  "psychological-portraits-pc",
  "psychological-portraits-mobile"
];

  for (const file of packFiles) {
    try {
      const response = await fetch(`/scripts/extensions/third-party/${extensionName}/regexes/${file}.json`);
      const pack = await response.json();
      window.RegexManagerData.packs[file] = pack;
      console.log(`[Regex Manager] Пак загружен: ${pack.name} (${pack.scripts.length} скриптов)`);
    } catch (e) {
      console.error(`[Regex Manager] Ошибка загрузки ${file}:`, e);
    }
  }
}

function renderPackList() {
  const container = $("#regex-manager-list");
  container.empty();

  for (const [id, pack] of Object.entries(window.RegexManagerData.packs)) {
    const enabled = window.RegexManagerData.enabled.includes(id);

    const html = `
      <div class="regex-pack">
        <label class="checkbox-label">
          <input type="checkbox" data-pack="${id}" ${enabled ? "checked" : ""} ${!window.RegexManagerData.active ? "disabled" : ""}>
          <span class="regex-pack-name">${pack.name}</span>
        </label>
        <div class="regex-pack-desc">${pack.description}</div>
        <div class="regex-pack-count">${pack.scripts.length} регексов</div>
      </div>
    `;
    container.append(html);
  }

  container.find("input[type=checkbox]").on("change", async function() {
    const packId = $(this).data("pack");
    const checked = $(this).is(":checked");

    if (checked) {
      if (!window.RegexManagerData.enabled.includes(packId)) {
        window.RegexManagerData.enabled.push(packId);
        if (window.RegexManagerData.active) {
          injectRegexPack(packId);
        }
      }
    } else {
      window.RegexManagerData.enabled = window.RegexManagerData.enabled.filter(p => p !== packId);
      removeRegexPack(packId);
    }

    saveSettings();

    const ctx = SillyTavern.getContext();
    if (ctx.reloadCurrentChat) {
      await ctx.reloadCurrentChat();
    }
  });
}

function saveSettings() {
  extension_settings[extensionName] = {
    enabled: window.RegexManagerData.enabled,
    active: window.RegexManagerData.active
  };
  saveSettingsDebounced();
}

function injectRegexPack(packId) {
  const pack = window.RegexManagerData.packs[packId];
  if (!pack) return;

  if (!Array.isArray(extension_settings.regex)) {
    extension_settings.regex = [];
  }

  let added = 0;
  for (const script of pack.scripts) {
    const newId = `rgxm-${packId}-${script.id}`;

    const existingIndex = extension_settings.regex.findIndex(r => r.id === newId);
    if (existingIndex !== -1) continue;

    const newRegex = {
      id: newId,
      scriptName: `[RM] ${script.scriptName}`,
      findRegex: script.findRegex,
      replaceString: script.replaceString,
      trimStrings: script.trimStrings || [],
      placement: script.placement || [1, 2, 6],
      disabled: false,
      markdownOnly: script.markdownOnly ?? true,
      promptOnly: script.promptOnly ?? false,
      runOnEdit: script.runOnEdit ?? true,
      substituteRegex: script.substituteRegex ?? 0,
      minDepth: script.minDepth ?? null,
      maxDepth: script.maxDepth ?? null
    };

    extension_settings.regex.push(newRegex);
    added++;
  }

  if (added > 0) {
    console.log(`[Regex Manager] Добавлено ${added} регексов из пака ${packId}`);
    saveSettingsDebounced();
  }
}

function removeRegexPack(packId) {
  if (!Array.isArray(extension_settings.regex)) return;

  const prefix = `rgxm-${packId}-`;
  let removed = 0;

  for (let i = extension_settings.regex.length - 1; i >= 0; i--) {
    if (extension_settings.regex[i].id && extension_settings.regex[i].id.startsWith(prefix)) {
      extension_settings.regex.splice(i, 1);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[Regex Manager] Удалено ${removed} регексов из пака ${packId}`);
    saveSettingsDebounced();
  }
}

window.RegexManager = {
  getPacks: () => window.RegexManagerData.packs,
  getEnabled: () => window.RegexManagerData.enabled,
  isActive: () => window.RegexManagerData.active,
  inject: injectRegexPack,
  remove: removeRegexPack,
  debug: openDebugger
};

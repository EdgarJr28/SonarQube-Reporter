/* =============================================================
   static/script.js — Lógica interactiva del dashboard SonarQube
   Servido por Flask (app.py). Consume window.REPORT_DATA (embebido
   en dashboard.html en cada petición, con datos en vivo) para dibujar
   los gráficos con Chart.js y alimentar la tabla de issues (búsqueda,
   orden, filtros, paginación). El selector de proyectos navega de
   verdad: su listener de "change" (más abajo, en initPageTransition)
   navega a window.APP_PREFIX + '/project/<key>' — el prefijo respeta que
   la app pueda estar montada bajo un sub-path detrás de un reverse proxy
   (ver ProxyFix en app.py).
   ============================================================= */

(function () {
  "use strict";

  const DATA = window.REPORT_DATA || {};

  // -----------------------------------------------------------
  // Colores consistentes con style.css (paleta tipo Apple HIG)
  // -----------------------------------------------------------
  const COLORS = {
    bug: "#ff3b30",
    vulnerability: "#ff9500",
    codeSmell: "#ffcc00",
    coverage: "#34c759",
    duplication: "#ff9500",
    remaining: "rgba(142,142,147,0.18)",
    severities: {
      BLOCKER: "#8b1a1a",
      CRITICAL: "#ff3b30",
      MAJOR: "#ff9500",
      MINOR: "#ffcc00",
      INFO: "#0071e3",
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    initCustomSelects();
    initDarkMode();
    initBackToTop();
    animateCounters();
    buildCharts();
    initIssuesTable();
    initPageTransition();
    initPrintHandling();
    initPdfExport();
    initPdfDetailMenu();
    initLastUpdated();
    initQualityGateFavicon();
  });

  // -----------------------------------------------------------
  // Selects personalizados (estilo "material"): reemplaza visualmente
  // los <select> nativos (selector de proyecto, filtros de tipo/
  // severidad) por un botón + panel flotante propio, ya que el menú
  // desplegable nativo de <option> no se puede maquetar de forma
  // consistente entre navegadores. El <select> original se mantiene
  // oculto (accesible, con su .value real) y sigue disparando el
  // evento "change" con normalidad, así que el resto del código
  // (filtros de la tabla, navegación del selector de proyecto) no
  // necesita cambios.
  // -----------------------------------------------------------
  function initCustomSelects() {
    const selects = document.querySelectorAll(
      "#projectSelector, #filterType, #filterSeverity"
    );

    selects.forEach((selectEl) => {
      if (selectEl.dataset.enhanced === "1") return;
      selectEl.dataset.enhanced = "1";

      const wrapper = document.createElement("div");
      wrapper.className = "custom-select";
      selectEl.classList.add("custom-select-native");
      selectEl.setAttribute("tabindex", "-1");
      selectEl.setAttribute("aria-hidden", "true");

      selectEl.parentNode.insertBefore(wrapper, selectEl);
      wrapper.appendChild(selectEl);

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "custom-select-trigger";
      if (selectEl.id === "projectSelector") {
        trigger.classList.add("trigger-pill");
        trigger.title = "Cambiar de proyecto";
      }
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");

      const labelSpan = document.createElement("span");
      labelSpan.className = "custom-select-label";
      trigger.appendChild(labelSpan);

      const chevron = document.createElement("i");
      chevron.className = "bi bi-chevron-down custom-select-chevron";
      trigger.appendChild(chevron);

      const panel = document.createElement("div");
      panel.className = "custom-select-panel";
      panel.setAttribute("role", "listbox");

      wrapper.appendChild(trigger);
      wrapper.appendChild(panel);

      function buildOptions() {
        panel.innerHTML = "";
        Array.from(selectEl.options).forEach((opt) => {
          const item = document.createElement("div");
          item.className = "custom-select-option" + (opt.selected ? " selected" : "");
          item.setAttribute("role", "option");
          item.dataset.value = opt.value;

          const text = document.createElement("span");
          text.textContent = opt.textContent;
          item.appendChild(text);

          const check = document.createElement("i");
          check.className = "bi bi-check-lg option-check";
          item.appendChild(check);

          item.addEventListener("click", () => {
            if (selectEl.value !== opt.value) {
              selectEl.value = opt.value;
              selectEl.dispatchEvent(new Event("change", { bubbles: true }));
            }
            closePanel();
          });

          panel.appendChild(item);
        });
      }

      function syncLabel() {
        const selectedOpt = selectEl.options[selectEl.selectedIndex];
        labelSpan.textContent = selectedOpt ? selectedOpt.textContent : "";
        panel.querySelectorAll(".custom-select-option").forEach((el) => {
          el.classList.toggle("selected", el.dataset.value === selectEl.value);
        });
      }

      function openPanel() {
        document.querySelectorAll(".custom-select.open").forEach((el) => {
          if (el !== wrapper) closeOther(el);
        });
        wrapper.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
      }

      function closePanel() {
        wrapper.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }

      function closeOther(el) {
        el.classList.remove("open");
        const otherTrigger = el.querySelector(".custom-select-trigger");
        if (otherTrigger) otherTrigger.setAttribute("aria-expanded", "false");
      }

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        wrapper.classList.contains("open") ? closePanel() : openPanel();
      });

      trigger.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePanel();
      });

      selectEl.addEventListener("change", syncLabel);

      buildOptions();
      syncLabel();
    });

    // Cierra cualquier panel abierto al hacer clic afuera o presionar Escape.
    document.addEventListener("click", () => {
      document.querySelectorAll(".custom-select.open").forEach((el) => {
        el.classList.remove("open");
        const trigger = el.querySelector(".custom-select-trigger");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document.querySelectorAll(".custom-select.open").forEach((el) => el.classList.remove("open"));
      }
    });
  }

  // -----------------------------------------------------------
  // Indicador "Actualizado hace Xs": como los datos se cachean unos
  // segundos antes de volver a consultar SonarQube, este texto deja
  // claro qué tan frescos son sin tener que adivinar.
  // -----------------------------------------------------------
  function initLastUpdated() {
    const el = document.getElementById("lastUpdatedText");
    const iso = DATA.generated_at && DATA.generated_at.iso;
    if (!el || !iso) return;

    const generatedAt = new Date(iso).getTime();
    if (Number.isNaN(generatedAt)) return;

    function formatElapsed(ms) {
      const seconds = Math.floor(ms / 1000);
      if (seconds < 5) return "Actualizado justo ahora";
      if (seconds < 60) return `Actualizado hace ${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `Actualizado hace ${minutes} min`;
      const hours = Math.floor(minutes / 60);
      return `Actualizado hace ${hours} h`;
    }

    function tick() {
      el.textContent = formatElapsed(Date.now() - generatedAt);
    }

    tick();
    setInterval(tick, 1000);
  }

  // -----------------------------------------------------------
  // Favicon/título dinámico según el estado del Quality Gate: permite
  // detectar si un proyecto pasó o falló con solo mirar la pestaña,
  // sin tener que volver a esta ventana.
  // -----------------------------------------------------------
  function initQualityGateFavicon() {
    const status = DATA.quality_gate && DATA.quality_gate.status;
    const colors = { OK: "#34c759", ERROR: "#ff3b30" };
    const color = colors[status] || "#8e8e93";

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = canvas.toDataURL("image/png");

    const prefix = status === "OK" ? "✓ " : status === "ERROR" ? "✕ " : "";
    if (prefix && !document.title.startsWith(prefix)) {
      document.title = prefix + document.title;
    }
  }

  // -----------------------------------------------------------
  // Impresión / Exportar a PDF: Chart.js a veces deja los canvas en
  // blanco si no se fuerza un resize/redibujado justo antes de que el
  // navegador rasterice la página. Forzamos ese resize en beforeprint
  // y lo revertimos en afterprint.
  // -----------------------------------------------------------
  function initPrintHandling() {
    window.addEventListener("beforeprint", () => {
      chartInstances.forEach((c) => c.resize());
    });
    window.addEventListener("afterprint", () => {
      chartInstances.forEach((c) => c.resize());
    });
  }

  // -----------------------------------------------------------
  // Overlay "Estamos preparando tu reporte..." al cambiar de
  // proyecto o pulsar Actualizar. La petición real se dispara con
  // fetch() para saber cuándo respondió la API; una vez responde,
  // se espera lo que falte hasta completar un mínimo de 3s para que
  // la animación se aprecie, y recién ahí se navega de verdad.
  // -----------------------------------------------------------
  function initPageTransition() {
    const overlay = document.getElementById("loadingOverlay");
    const selector = document.getElementById("projectSelector");
    const refreshBtn = document.getElementById("refreshBtn");
    const MIN_DISPLAY_MS = 3000;

    if (!overlay) return;

    function navigateWithLoader(targetUrl) {
      overlay.classList.add("active");
      const start = performance.now();

      fetch(targetUrl, { credentials: "same-origin" })
        .then(() => {
          const elapsed = performance.now() - start;
          const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
          setTimeout(() => {
            window.location.href = targetUrl;
          }, remaining);
        })
        .catch(() => {
          // Si el fetch falla, navegamos igual para que el usuario
          // vea el error real (p. ej. SonarQube caído).
          setTimeout(() => {
            window.location.href = targetUrl;
          }, MIN_DISPLAY_MS);
        });
    }

    if (selector) {
      const currentValue = selector.value;
      selector.addEventListener("change", () => {
        if (selector.value === currentValue) return;
        const prefix = window.APP_PREFIX || "";
        navigateWithLoader(prefix + "/project/" + encodeURIComponent(selector.value));
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", (e) => {
        e.preventDefault();
        navigateWithLoader(refreshBtn.getAttribute("href"));
      });
    }

    // Si el usuario vuelve con el botón "atrás" del navegador y la
    // página se restaura desde bfcache, aseguramos que el overlay
    // no quede visible por error.
    window.addEventListener("pageshow", () => {
      overlay.classList.remove("active");
    });
  }

  // -----------------------------------------------------------
  // Menú de nivel de detalle del PDF ("Completo" vs "Resumen ejecutivo"):
  // solo cambia los atributos data-* del botón principal de exportar;
  // initPdfExport() lee esos atributos al momento de generar el PDF.
  // -----------------------------------------------------------
  function initPdfDetailMenu() {
    const caret = document.getElementById("pdfDetailCaret");
    const menu = document.getElementById("pdfDetailMenu");
    const mainBtn = document.getElementById("exportPdfBtn");
    const label = document.getElementById("exportPdfLabel");
    if (!caret || !menu || !mainBtn) return;

    function closeMenu() {
      menu.hidden = true;
      caret.setAttribute("aria-expanded", "false");
    }

    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !menu.hidden;
      menu.hidden = isOpen;
      caret.setAttribute("aria-expanded", String(!isOpen));
    });

    menu.querySelectorAll(".pdf-detail-option").forEach((option) => {
      option.addEventListener("click", () => {
        const detail = option.dataset.detail;
        mainBtn.setAttribute("data-pdf-detail", detail);
        if (label) {
          label.textContent = detail === "summary" ? "Exportar PDF (resumen)" : "Exportar PDF (completo)";
        }
        menu.querySelectorAll(".pdf-detail-option").forEach((o) => o.classList.remove("selected"));
        option.classList.add("selected");
        closeMenu();
      });
    });

    document.addEventListener("click", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== caret) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  // -----------------------------------------------------------
  // Exportar PDF: la generación ocurre en el servidor (matplotlib +
  // WeasyPrint) y puede tardar varios segundos. En vez de bloquear la
  // pantalla con el overlay de carga, se muestra un popup flotante
  // (estilo notificación, esquina inferior izquierda) con mensajes
  // rotativos y una barra de progreso indeterminada, mientras el
  // usuario sigue viendo y navegando el reporte con normalidad. La
  // descarga se dispara con fetch + Blob para poder controlar
  // exactamente cuándo mostrar/ocultar el popup.
  // -----------------------------------------------------------
  function initPdfExport() {
    const btn = document.getElementById("exportPdfBtn");
    const toast = document.getElementById("pdfExportToast");
    const messageEl = document.getElementById("pdfExportMessage");
    if (!btn || !toast) return;

    const STEP_MESSAGES = [
      "Consultando datos de SonarQube…",
      "Generando los gráficos del reporte…",
      "Maquetando el documento PDF…",
      "Ya casi está listo…",
    ];
    const STEP_INTERVAL_MS = 2200;

    btn.addEventListener("click", async () => {
      const baseUrl = btn.getAttribute("data-pdf-base-url");
      const filenameBase = btn.getAttribute("data-filename-base") || "reporte-sonarqube";
      const detail = btn.getAttribute("data-pdf-detail") || "full";
      if (!baseUrl) return;

      const url = `${baseUrl}?detail=${encodeURIComponent(detail)}`;
      const suffix = detail === "summary" ? "resumen" : "completo";
      const filename = `${filenameBase}-${suffix}.pdf`;

      btn.disabled = true;
      let stepIndex = 0;
      messageEl.textContent = STEP_MESSAGES[stepIndex];
      toast.hidden = false;

      const stepTimer = setInterval(() => {
        stepIndex = Math.min(stepIndex + 1, STEP_MESSAGES.length - 1);
        messageEl.textContent = STEP_MESSAGES[stepIndex];
      }, STEP_INTERVAL_MS);

      try {
        const response = await fetch(url, { credentials: "same-origin" });

        if (!response.ok) {
          let detail = `HTTP ${response.status}`;
          try {
            const text = await response.text();
            const match = text.match(/<p[^>]*class="error-message"[^>]*>([\s\S]*?)<\/p>/i);
            if (match) detail = match[1].replace(/<[^>]+>/g, "").trim();
          } catch (_e) {
            /* usamos el detalle genérico */
          }
          throw new Error(detail);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);

        showToast("PDF generado correctamente.");
      } catch (err) {
        showToast("No se pudo generar el PDF: " + err.message, 5000);
      } finally {
        clearInterval(stepTimer);
        toast.hidden = true;
        btn.disabled = false;
      }
    });
  }

  // -----------------------------------------------------------
  // Toasts (notificaciones ligeras, estilo Apple)
  // -----------------------------------------------------------
  function showToast(message, duration = 3200) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  window.showToast = showToast;

  // -----------------------------------------------------------
  // Modo oscuro
  // -----------------------------------------------------------
  function initDarkMode() {
    const toggle = document.getElementById("darkModeToggle");
    const root = document.documentElement;
    const saved = localStorage.getItem("sonar-report-theme");

    if (saved === "dark") {
      root.setAttribute("data-theme", "dark");
      toggle.innerHTML = '<i class="bi bi-sun-fill"></i>';
    }

    toggle.addEventListener("click", () => {
      const isDark = root.getAttribute("data-theme") === "dark";
      if (isDark) {
        root.removeAttribute("data-theme");
        toggle.innerHTML = '<i class="bi bi-moon-stars-fill"></i>';
        localStorage.setItem("sonar-report-theme", "light");
      } else {
        root.setAttribute("data-theme", "dark");
        toggle.innerHTML = '<i class="bi bi-sun-fill"></i>';
        localStorage.setItem("sonar-report-theme", "dark");
      }
      buildCharts();
    });
  }

  // -----------------------------------------------------------
  // Botón volver arriba
  // -----------------------------------------------------------
  function initBackToTop() {
    const btn = document.getElementById("backToTop");
    window.addEventListener("scroll", () => {
      btn.style.display = window.scrollY > 300 ? "flex" : "none";
    });
    btn.style.display = "none";
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // -----------------------------------------------------------
  // Contador animado para tarjetas (bugs, vulnerabilidades, etc.)
  // -----------------------------------------------------------
  function animateCounters() {
    document.querySelectorAll(".counter").forEach((el) => {
      const target = parseInt(el.dataset.target, 10) || 0;
      const duration = 900;
      const start = performance.now();

      function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const value = Math.floor(progress * target);
        el.textContent = value.toLocaleString("es-ES");
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = target.toLocaleString("es-ES");
        }
      }
      requestAnimationFrame(step);
    });
  }

  // -----------------------------------------------------------
  // Construcción de gráficos con Chart.js
  // -----------------------------------------------------------
  let chartInstances = [];

  function buildCharts() {
    chartInstances.forEach((c) => c.destroy());
    chartInstances = [];

    const gridColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--hairline")
      .trim();
    const textColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--text-main")
      .trim();

    Chart.defaults.color = textColor;
    Chart.defaults.borderColor = gridColor;
    Chart.defaults.font.family =
      "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif";

    buildBarComparisonChart();
    buildDoughnutCoverageChart();
    buildPieSeverityChart();
    buildTopFilesChart();
    buildTopRulesChart();
    buildTrendChart();
  }

  // Sparkline de tendencia (bugs por día) en el hero de health score.
  // Solo existe si hay >= 2 snapshots históricos (ver data.history en app.py).
  function buildTrendChart() {
    const ctx = document.getElementById("chartTrend");
    if (!ctx) return;
    const history = DATA.history || [];

    chartInstances.push(
      new Chart(ctx, {
        type: "line",
        data: {
          labels: history.map((h) => h.date),
          datasets: [
            {
              data: history.map((h) => h.bugs),
              borderColor: COLORS.bug,
              backgroundColor: "rgba(255,59,48,0.1)",
              fill: true,
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => history[items[0].dataIndex].date,
                label: (item) => `${item.parsed.y} bugs`,
              },
            },
          },
          scales: { x: { display: false }, y: { display: false } },
        },
      })
    );
  }

  // -----------------------------------------------------------
  // Estados vacíos de gráficos: en vez de mostrar un gráfico "roto" o
  // plano en cero (o directamente en blanco, como pasa con un pie chart
  // sin datos), se reemplaza por un mensaje positivo con ícono. Aplica
  // tanto a "sin issues de este tipo" como a proyectos 100% limpios.
  // -----------------------------------------------------------
  function renderChartEmptyState(canvas, message) {
    if (!canvas) return;
    canvas.style.display = "none";
    let emptyEl = canvas.parentElement.querySelector(".chart-empty-state");
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.className = "chart-empty-state";
      canvas.parentElement.appendChild(emptyEl);
    }
    emptyEl.innerHTML = `<i class="bi bi-emoji-laughing"></i><p>${message}</p>`;
    emptyEl.style.display = "flex";
  }

  function clearChartEmptyState(canvas) {
    if (!canvas) return;
    canvas.style.display = "";
    const emptyEl = canvas.parentElement.querySelector(".chart-empty-state");
    if (emptyEl) emptyEl.style.display = "none";
  }

  function buildBarComparisonChart() {
    const ctx = document.getElementById("chartBarComparison");
    const m = DATA.measures || {};
    const bugs = m.bugs || 0;
    const codeSmells = m.code_smells || 0;
    const vulnerabilities = m.vulnerabilities || 0;

    if (bugs + codeSmells + vulnerabilities === 0) {
      renderChartEmptyState(ctx, "Sin bugs, code smells ni vulnerabilidades. ¡Excelente trabajo!");
      return;
    }
    clearChartEmptyState(ctx);

    chartInstances.push(
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: ["Bugs", "Code Smells", "Vulnerabilidades"],
          datasets: [
            {
              label: "Cantidad",
              data: [bugs, codeSmells, vulnerabilities],
              backgroundColor: [COLORS.bug, COLORS.codeSmell, COLORS.vulnerability],
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      })
    );
  }

  function buildDoughnutCoverageChart() {
    const ctx = document.getElementById("chartDoughnutCoverage");
    const m = DATA.measures || {};
    const coverage = m.coverage || 0;
    const duplication = m.duplication || 0;

    chartInstances.push(
      new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["Cobertura", "Sin cobertura", "Duplicación"],
          datasets: [
            {
              data: [coverage, Math.max(0, 100 - coverage), duplication],
              backgroundColor: [COLORS.coverage, COLORS.remaining, COLORS.duplication],
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      })
    );
  }

  function buildPieSeverityChart() {
    const ctx = document.getElementById("chartPieSeverity");
    const sev = DATA.severity_distribution || {};
    const labels = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
    const total = labels.reduce((sum, l) => sum + (sev[l] || 0), 0);

    if (total === 0) {
      renderChartEmptyState(ctx, "No se registraron issues por severidad.");
      return;
    }
    clearChartEmptyState(ctx);

    chartInstances.push(
      new Chart(ctx, {
        type: "pie",
        data: {
          labels,
          datasets: [
            {
              data: labels.map((l) => sev[l] || 0),
              backgroundColor: labels.map((l) => COLORS.severities[l]),
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      })
    );
  }

  function buildTopFilesChart() {
    const ctx = document.getElementById("chartTopFiles");
    const topFiles = DATA.top_files || [];

    if (topFiles.length === 0) {
      renderChartEmptyState(ctx, "Ningún archivo tiene issues registrados.");
      return;
    }
    clearChartEmptyState(ctx);

    chartInstances.push(
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: topFiles.map((f) => f[0]),
          datasets: [
            {
              label: "Issues",
              data: topFiles.map((f) => f[1]),
              backgroundColor: "#0071e3",
              borderRadius: 6,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      })
    );
  }

  function buildTopRulesChart() {
    const ctx = document.getElementById("chartTopRules");
    const topRules = DATA.top_rules || [];

    if (topRules.length === 0) {
      renderChartEmptyState(ctx, "No hay reglas incumplidas para mostrar.");
      return;
    }
    clearChartEmptyState(ctx);

    chartInstances.push(
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: topRules.map((r) => r[0]),
          datasets: [
            {
              label: "Incumplimientos",
              data: topRules.map((r) => r[1]),
              backgroundColor: "#af52de",
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0 } },
            x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 30 } },
          },
        },
      })
    );
  }

  // -----------------------------------------------------------
  // Tabla de issues con AG Grid: búsqueda, filtros, orden, paginación
  // y ajuste automático de columnas (evita que el contenido se
  // desborde con mensajes/reglas largas).
  // -----------------------------------------------------------
  let issuesGridApi = null;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str === undefined || str === null ? "" : str;
    return div.innerHTML;
  }

  // Íconos distintivos por tipo/severidad (además del color): así la
  // información no depende solo del color, algo importante para
  // personas con daltonismo.
  const TYPE_ICONS = {
    BUG: "bi-bug-fill",
    VULNERABILITY: "bi-shield-exclamation",
    CODE_SMELL: "bi-emoji-frown-fill",
  };
  const SEVERITY_ICONS = {
    BLOCKER: "bi-exclamation-octagon-fill",
    CRITICAL: "bi-exclamation-triangle-fill",
    MAJOR: "bi-exclamation-circle-fill",
    MINOR: "bi-dash-circle-fill",
    INFO: "bi-info-circle-fill",
  };

  function badgeRenderer(cssPrefix, iconMap) {
    return (params) => {
      const value = params.value == null ? "" : String(params.value);
      const safe = escapeHtml(value);
      const icon = iconMap && iconMap[value] ? `<i class="bi ${iconMap[value]}"></i> ` : "";
      return `<span class="${cssPrefix}-${safe}">${icon}${safe}</span>`;
    };
  }

  function initIssuesTable() {
    const allIssues = DATA.issues || [];

    const gridDiv = document.getElementById("issuesGrid");
    const searchInput = document.getElementById("issueSearch");
    const filterType = document.getElementById("filterType");
    const filterSeverity = document.getElementById("filterSeverity");

    if (!gridDiv || typeof agGrid === "undefined") return;

    // Restaura los filtros desde la URL (?search=&type=&severity=) si
    // vienen en el link — permite compartir/recargar una vista filtrada
    // sin perderla. Los <select> son los nativos (ocultos): al ponerles
    // el valor aquí, el custom-select ya construido los reflejará
    // porque ambos leen/escriben sobre el mismo <select>.
    const initialParams = new URLSearchParams(window.location.search);
    if (initialParams.has("search")) searchInput.value = initialParams.get("search");
    if (initialParams.has("type")) filterType.value = initialParams.get("type");
    if (initialParams.has("severity")) filterSeverity.value = initialParams.get("severity");
    // Si el custom-select ya se construyó (initCustomSelects corre antes),
    // sincronizamos su etiqueta/opción resaltada con el valor restaurado.
    [filterType, filterSeverity].forEach((sel) => {
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });

    function updateUrlParams(term, typeVal, sevVal) {
      const params = new URLSearchParams(window.location.search);
      term ? params.set("search", term) : params.delete("search");
      typeVal ? params.set("type", typeVal) : params.delete("type");
      sevVal ? params.set("severity", sevVal) : params.delete("severity");
      const query = params.toString();
      const newUrl = window.location.pathname + (query ? `?${query}` : "");
      window.history.replaceState(null, "", newUrl);
    }

    const columnDefs = [
      {
        headerName: "Tipo",
        field: "type",
        minWidth: 150,
        cellRenderer: badgeRenderer("badge-type badge", TYPE_ICONS),
      },
      {
        headerName: "Severidad",
        field: "severity",
        minWidth: 150,
        cellRenderer: badgeRenderer("badge-severity badge", SEVERITY_ICONS),
      },
      { headerName: "Archivo", field: "file", flex: 2, minWidth: 220, tooltipField: "file" },
      { headerName: "Línea", field: "line", width: 90, type: "rightAligned" },
      {
        headerName: "Regla",
        field: "rule",
        minWidth: 170,
        cellRenderer: (params) => `<code>${escapeHtml(params.value)}</code>`,
      },
      {
        headerName: "Mensaje",
        field: "message",
        flex: 3,
        minWidth: 280,
        tooltipField: "message",
        wrapText: true,
        autoHeight: true,
      },
      { headerName: "Estado", field: "status", width: 120 },
      { headerName: "Autor", field: "author", minWidth: 150 },
      { headerName: "Fecha", field: "date", width: 160 },
    ];

    function applyFilters() {
      const term = (searchInput.value || "").toLowerCase().trim();
      const typeVal = filterType.value;
      const sevVal = filterSeverity.value;

      const filtered = allIssues.filter((issue) => {
        const matchesTerm =
          !term ||
          issue.message.toLowerCase().includes(term) ||
          issue.file.toLowerCase().includes(term) ||
          issue.rule.toLowerCase().includes(term) ||
          issue.author.toLowerCase().includes(term);

        const matchesType = !typeVal || issue.type === typeVal;
        const matchesSeverity = !sevVal || issue.severity === sevVal;

        return matchesTerm && matchesType && matchesSeverity;
      });

      if (issuesGridApi) {
        issuesGridApi.setGridOption("rowData", filtered);
      }
      updateUrlParams(term, typeVal, sevVal);
    }

    // Densidad de la tabla (compacta/cómoda), persistida en localStorage.
    const DENSITY_KEY = "sonar-report-grid-density";
    const densityBtn = document.getElementById("gridDensityToggle");
    const densityLabel = document.getElementById("gridDensityLabel");
    let density = localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";

    function rowHeightFor(mode) { return mode === "compact" ? 32 : 44; }
    function headerHeightFor(mode) { return mode === "compact" ? 32 : 40; }

    function applyDensity(mode, persist) {
      density = mode;
      if (issuesGridApi) {
        issuesGridApi.setGridOption("rowHeight", rowHeightFor(mode));
        issuesGridApi.setGridOption("headerHeight", headerHeightFor(mode));
      }
      if (densityLabel) densityLabel.textContent = mode === "compact" ? "Compacta" : "Cómoda";
      if (persist) localStorage.setItem(DENSITY_KEY, mode);
    }

    const gridOptions = {
      columnDefs,
      rowData: [...allIssues],
      rowHeight: rowHeightFor(density),
      headerHeight: headerHeightFor(density),
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: false,
      },
      pagination: true,
      paginationPageSize: 25,
      paginationPageSizeSelector: [25, 50, 100],
      animateRows: true,
      suppressCellFocus: true,
      overlayNoRowsTemplate: allIssues.length === 0
        ? '<div class="grid-empty-state"><i class="bi bi-emoji-laughing"></i><p>¡Este proyecto no tiene issues registrados!</p></div>'
        : '<div class="grid-empty-state"><i class="bi bi-search"></i><p>No se encontraron issues con los filtros aplicados.</p></div>',
      domLayout: "normal",
    };

    issuesGridApi = agGrid.createGrid(gridDiv, gridOptions);
    applyDensity(density, false);

    if (densityBtn) {
      densityBtn.addEventListener("click", () => {
        applyDensity(density === "compact" ? "comfortable" : "compact", true);
      });
    }

    // Si se restauraron filtros desde la URL, aplicarlos ya mismo en vez
    // de esperar a la primera interacción del usuario.
    if (initialParams.has("search") || initialParams.has("type") || initialParams.has("severity")) {
      applyFilters();
    }

    let searchDebounce;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(applyFilters, 200);
    });
    filterType.addEventListener("change", applyFilters);
    filterSeverity.addEventListener("change", applyFilters);

    // Al imprimir/exportar a PDF, AG Grid pasa a domLayout "print":
    // desactiva la virtualización y la paginación para que se
    // rendericen TODAS las filas filtradas, una debajo de otra.
    window.addEventListener("beforeprint", () => {
      if (!issuesGridApi) return;
      issuesGridApi.setGridOption("domLayout", "print");
      issuesGridApi.setGridOption("pagination", false);
    });
    window.addEventListener("afterprint", () => {
      if (!issuesGridApi) return;
      issuesGridApi.setGridOption("domLayout", "normal");
      issuesGridApi.setGridOption("pagination", true);
    });
  }
})();

(function () {
  const TARGET_SELECTOR = ".vip-liquid-glass";
  const DEFS_ID = "vip-liquid-glass-defs";
  const LIQUID_GLASS_QUERY = "(min-width: 1100px) and (min-height: 650px) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
  const CONFIG = {
    thickness: 46,
    ior: 2.1,
    scaleRatio: 0.34,
    blur: 0.7,
    displacementSmooth: 0.24,
    mapOversample: 0.9,
    maxMapScale: 1.5,
  };
  const ELEMENT_CONFIG = [
    {
      selector: ".dubai-copy",
      scaleRatio: 0.52,
    },
    {
      selector: ".reviews-pill",
      scaleRatio: 0.48,
    },
  ];

  const surfaceFn = (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);
  let rebuildTimer = 0;
  let resizeObserver = null;

  function calculateRefractionProfile(glassThickness, bezelWidth, heightFn, ior, samples) {
    const eta = 1 / ior;

    function refract(nx, ny) {
      const dot = ny;
      const k = 1 - eta * eta * (1 - dot * dot);
      if (k < 0) return null;

      const sq = Math.sqrt(k);
      return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny];
    }

    const profile = new Float64Array(samples);
    for (let i = 0; i < samples; i += 1) {
      const x = i / samples;
      const y = heightFn(x);
      const dx = x < 1 ? 0.0001 : -0.0001;
      const y2 = heightFn(x + dx);
      const deriv = (y2 - y) / dx;
      const mag = Math.sqrt(deriv * deriv + 1);
      const ref = refract(-deriv / mag, -1 / mag);

      if (!ref) {
        profile[i] = 0;
        continue;
      }

      profile[i] = ref[0] * ((y * bezelWidth + glassThickness) / ref[1]);
    }

    return profile;
  }

  function generateDisplacementMap(width, height, radius, bezelWidth, profile, maxDisp, pixelRatio) {
    const mapWidth = Math.max(1, Math.round(width * pixelRatio));
    const mapHeight = Math.max(1, Math.round(height * pixelRatio));
    const canvas = document.createElement("canvas");
    canvas.width = mapWidth;
    canvas.height = mapHeight;

    const context = canvas.getContext("2d");
    const image = context.createImageData(mapWidth, mapHeight);
    const data = image.data;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }

    const radiusSq = radius * radius;
    const radiusOuterSq = (radius + 1) ** 2;
    const radiusBezelSq = Math.max(radius - bezelWidth, 0) ** 2;
    const straightWidth = width - radius * 2;
    const straightHeight = height - radius * 2;
    const sampleCount = profile.length;

    for (let yPos = 0; yPos < mapHeight; yPos += 1) {
      for (let xPos = 0; xPos < mapWidth; xPos += 1) {
        const cssX = xPos / pixelRatio;
        const cssY = yPos / pixelRatio;
        const x = cssX < radius ? cssX - radius : cssX >= width - radius ? cssX - radius - straightWidth : 0;
        const y = cssY < radius ? cssY - radius : cssY >= height - radius ? cssY - radius - straightHeight : 0;
        const distSq = x * x + y * y;

        if (distSq > radiusOuterSq || distSq < radiusBezelSq) continue;

        const dist = Math.sqrt(distSq);
        const fromSide = radius - dist;
        const opacity = distSq < radiusSq
          ? 1
          : 1 - (dist - Math.sqrt(radiusSq)) / (Math.sqrt(radiusOuterSq) - Math.sqrt(radiusSq));

        if (opacity <= 0 || dist === 0) continue;

        const cos = x / dist;
        const sin = y / dist;
        const sampleIndex = Math.min(((fromSide / bezelWidth) * sampleCount) | 0, sampleCount - 1);
        const displacement = profile[sampleIndex] || 0;
        const dx = (-cos * displacement) / maxDisp;
        const dy = (-sin * displacement) / maxDisp;
        const index = (yPos * mapWidth + xPos) * 4;

        data[index] = (128 + dx * 127 * opacity + 0.5) | 0;
        data[index + 1] = (128 + dy * 127 * opacity + 0.5) | 0;
      }
    }

    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }

  function parseRadius(value) {
    const radius = Number.parseFloat(String(value).split(" ")[0]);
    return Number.isFinite(radius) ? radius : 0;
  }

  function getElementRadius(element, width, height) {
    const styles = window.getComputedStyle(element);
    const radii = [
      styles.borderTopLeftRadius,
      styles.borderTopRightRadius,
      styles.borderBottomRightRadius,
      styles.borderBottomLeftRadius,
    ].map(parseRadius);
    const radius = Math.max(...radii, 0);

    return Math.max(2, Math.min(radius, Math.min(width, height) / 2 - 1));
  }

  function getElementConfig(element) {
    const override = ELEMENT_CONFIG.find((item) => element.matches(item.selector));
    return override ? { ...CONFIG, ...override } : CONFIG;
  }

  function buildFilter(element, index) {
    const config = getElementConfig(element);
    const rect = element.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width < 4 || height < 4) return "";

    const radius = getElementRadius(element, width, height);
    const bezelWidth = Math.max(2, Math.min(radius - 1, Math.min(width, height) * 0.17));
    const profile = calculateRefractionProfile(config.thickness, bezelWidth, surfaceFn, config.ior, 96);
    const maxDisp = Math.max(...Array.from(profile, Math.abs)) || 1;
    const pixelRatio = Math.min(Math.max((window.devicePixelRatio || 1) * config.mapOversample, 1), config.maxMapScale);
    const displacementMap = generateDisplacementMap(width, height, radius, bezelWidth, profile, maxDisp, pixelRatio);
    const scale = maxDisp * config.scaleRatio;
    const id = `vip-liquid-glass-filter-${index}`;

    element.style.setProperty("--vip-liquid-filter", `url(#${id})`);

    return `
      <filter id="${id}" x="0%" y="0%" width="100%" height="100%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${config.blur}" result="blurred_source" />
        <feImage href="${displacementMap}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="disp_map" />
        <feGaussianBlur in="disp_map" stdDeviation="${config.displacementSmooth}" result="disp_map_smooth" />
        <feDisplacementMap in="blurred_source" in2="disp_map_smooth" scale="${scale}" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    `;
  }

  function rebuildFilters() {
    const defs = document.getElementById(DEFS_ID);
    if (!defs) return;

    const elements = Array.from(document.querySelectorAll(TARGET_SELECTOR));
    if (!window.matchMedia(LIQUID_GLASS_QUERY).matches) {
      defs.innerHTML = "";
      elements.forEach((element) => element.style.removeProperty("--vip-liquid-filter"));
      document.body.classList.remove("vip-liquid-glass-ready");
      document.body.classList.add("vip-liquid-glass-fallback");
      return;
    }

    defs.innerHTML = elements.map(buildFilter).join("");
    document.body.classList.add("vip-liquid-glass-ready");
    document.body.classList.remove("vip-liquid-glass-fallback");
  }

  function scheduleRebuild(delay) {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(rebuildFilters, delay);
  }

  function init() {
    const elements = Array.from(document.querySelectorAll(TARGET_SELECTOR));
    if (!elements.length) return;

    rebuildFilters();

    if ("ResizeObserver" in window && !resizeObserver) {
      resizeObserver = new ResizeObserver(() => scheduleRebuild(80));
      elements.forEach((element) => resizeObserver.observe(element));
    } else {
      window.addEventListener("resize", () => scheduleRebuild(140));
    }

    const mediaQuery = window.matchMedia(LIQUID_GLASS_QUERY);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", () => scheduleRebuild(80));
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(() => scheduleRebuild(80));
    }
  }

  window.addEventListener("load", () => {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.finally(init);
      return;
    }

    init();
  });
})();

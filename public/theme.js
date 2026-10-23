(function () {
  var stored = null;
  try {
    stored = window.localStorage.getItem("github-ui.theme");
  } catch (error) {
    stored = null;
  }

  var theme = stored === "light" || stored === "dark" ? stored : "system";
  if (theme === "system") {
    var prefersDark = true;
    try {
      prefersDark =
        typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : true;
    } catch (error) {
      prefersDark = true;
    }
    theme = prefersDark ? "dark" : "light";
  }

  document.documentElement.dataset.theme = theme;
})();

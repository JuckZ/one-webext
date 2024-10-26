chrome.devtools.panels.sources.createSidebarPane("Download", (pane) => {
  pane.setPage("dist/devtools-page/index.html")
})

chrome.devtools.panels.create(
  "AIO",
  '',
  "dist/devtools-page/index.html",
  function (panel) {
    console.log("my panel created")
  },
)

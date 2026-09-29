// A browser for the component tests: happy-dom, registered as the globals a
// page has. Imported first by a test file, before any component module.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  url: "https://plugin.example/app/",
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true },
});

import type { Page } from "@playwright/test";

// Exercise the same step navigation and disclosures available to the user.
export async function revealControl(page: Page, id: string) {
  const importing = ["autoDetect", "sort", "demo", "clear"];
  const exporting = [
    "export",
    "format",
    "aspect",
    "quality",
    "projectName",
    "allowOriginal",
  ];
  const stage = importing.includes(id)
    ? "import"
    : exporting.includes(id)
      ? "export"
      : "review";
  if (!(await page.locator(`#${stage}Screen`).isVisible()))
    await page
      .locator(`#step${stage[0].toUpperCase()}${stage.slice(1)}`)
      .click();
  const detail =
    id === "autoOrganize"
      ? "automaticPanel"
      : ["autoDetect", "sort", "clear"].includes(id)
        ? "importSettings"
        : id === "allowOriginal"
          ? "exportOptions"
          : [
                "pointSelect",
                "pointX",
                "pointY",
                "applyPoint",
                "autoNext",
                "whole",
                "reset",
                "inherit",
                "brightness",
                "contrast",
              ].includes(id)
            ? "editTools"
            : [
                  "excludeSelected",
                  "restoreSelected",
                  "movePosition",
                  "moveSelected",
                  "pageTools",
                ].includes(id)
              ? "pageTools"
              : "";
  if (detail && !(await page.locator(`#${detail}[open]`).count()))
    await page.locator(`#${detail} > summary`).click();
}

export async function dropOriginalCache(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("report-photo-organizer");
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("originals", "readwrite");
        tx.objectStore("originals").clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
  });
}

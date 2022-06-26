import got from "got";

import { WebImporterType, WebContentType } from "./importers/importer";
import { ArXivWebImporter } from "./importers/arxiv";
import { GoogleScholarWebImporter } from "./importers/google-scholar";
import { IEEEWebImporter } from "./importers/ieee";
import { EmbedWebImporter } from "./importers/embed";

import { Preference } from "../../utils/preference";
import { SharedState } from "../../utils/appstate";
import { PaperEntityDraft } from "../../models/PaperEntityDraft";

export class WebImporterRepository {
  sharedState: SharedState;
  preference: Preference;

  importerList: Record<string, WebImporterType>;

  constructor(sharedState: SharedState, preference: Preference) {
    this.sharedState = sharedState;
    this.preference = preference;

    this.importerList = {
      arxiv: new ArXivWebImporter(this.preference),
      googlescholar: new GoogleScholarWebImporter(this.preference),
      ieee: new IEEEWebImporter(this.preference),
      embed: new EmbedWebImporter(this.preference),
    };
  }

  async parse(webContent: WebContentType): Promise<PaperEntityDraft | boolean> {
    let parsed: PaperEntityDraft | boolean = false;
    for (const [name, importer] of Object.entries(this.importerList)) {
      try {
        parsed = await importer.parse(webContent);
      } catch (error) {
        this.sharedState.set(
          "viewState.alertInformation",
          `Web importer ${name} error: ${error as string}`
        );
      }
      if (parsed) {
        break;
      }
    }
    return parsed;
  }
}
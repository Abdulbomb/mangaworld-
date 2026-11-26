import {
  Chapter,
  ChapterData,
  Content,
  Highlight,
  NetworkClient,
  PagedResult,
  Property,
  PublicationStatus,
  ReadingMode,
  SearchRequest,
  Source,
  SourceInfo,
} from "@suwatte/daisuke";
import * as cheerio from "cheerio";

const BASE_URL = "https://www.mangaworld.me";

export class Target extends Source {
  info: SourceInfo = {
    name: "MangaWorld",
    id: "it.mangaworld.custom",
    version: 1,
    thumbnail: "mangaworld.png", // Assicurati di avere un'icona con questo nome in assets/ o usa default.png
    website: BASE_URL,
    supportedLanguages: ["it"],
    nsfw: false,
  };

  private client = new NetworkClient();

  private async fetchHTML(url: string): Promise<cheerio.CheerioAPI> {
    const response = await this.client.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Referer: BASE_URL,
      },
    });
    return cheerio.load(response.data);
  }

  // 1. Ricerca e lista Popular (usata anche dall'Availability Test)
  async getSearchResults(query: SearchRequest): Promise<PagedResult> {
    const page = query.page ?? 1;
    let url = `${BASE_URL}/archive?page=${page}`;

    if (query.query && query.query.trim().length > 0) {
      url += `&keyword=${encodeURIComponent(query.query.trim())}`;
    } else {
      // Ordinamento default per "Popular" / "Più letti"
      url += `&sort=most_read`;
    }

    const $ = await this.fetchHTML(url);
    const results: Highlight[] = [];

    $(".comics-grid .entry").each((_, el) => {
      const linkEl = $(el).find("a.thumb");
      const href = linkEl.attr("href") || "";
      const title =
        linkEl.attr("title")?.trim() ||
        $(el).find(".manga-title").text().trim();
      const cover =
        linkEl.find("img").attr("src") ||
        linkEl.find("img").attr("data-src") ||
        "";

      // Estrae l'ID relativo (es. /manga/1234/nome-manga)
      const contentId = href.replace(BASE_URL, "");

      if (contentId && title) {
        results.push({
          id: contentId,
          title,
          cover,
        });
      }
    });

    const hasNextPage = $(".pagination .page-item.active").next().length > 0;

    return {
      results,
      isLastPage: !hasNextPage,
    };
  }

  // 2. Dettagli del Manga (trama, autore, copertina, stato)
  async getContent(contentId: string): Promise<Content> {
    const url = contentId.startsWith("http")
      ? contentId
      : `${BASE_URL}${contentId}`;
    const $ = await this.fetchHTML(url);

    const title = $(".comic-info .name").first().text().trim();
    const cover = $(".comic-info .thumb img").attr("src") || "";
    const summary = $("#noidungm").text().trim() || $(".comic-description").text().trim();

    // Estrazione metadati (Autore, Stato, ecc.)
    let status = PublicationStatus.ONGOING;
    const creators: string[] = [];

    $(".comic-info .meta-data .col-12").each((_, el) => {
      const label = $(el).find("span").first().text().toLowerCase();
      const value = $(el).text().replace($(el).find("span").first().text(), "").trim();

      if (label.includes("autore") || label.includes("artista")) {
        if (value) creators.push(value);
      }
      if (label.includes("stato")) {
        if (value.toLowerCase().includes("finito") || value.toLowerCase().includes("completato")) {
          status = PublicationStatus.COMPLETED;
        } else if (value.toLowerCase().includes("pausa")) {
          status = PublicationStatus.HIATUS;
        } else if (value.toLowerCase().includes("cancellato")) {
          status = PublicationStatus.CANCELLED;
        }
      }
    });

    return {
      title,
      cover,
      summary,
      status,
      creators,
      webUrl: url,
      recommendedPanelMode: ReadingMode.PAGED_MANGA,
    };
  }

  // 3. Elenco dei Capitoli
  async getChapters(contentId: string): Promise<Chapter[]> {
    const url = contentId.startsWith("http")
      ? contentId
      : `${BASE_URL}${contentId}`;
    const $ = await this.fetchHTML(url);
    const chapters: Chapter[] = [];

    // MangaWorld raggruppa i capitoli per volume o direttamente in .chapters-wrapper
    const chapterElements = $(".chapters-wrapper .chapter");

    chapterElements.each((index, el) => {
      const linkEl = $(el).find("a.chap");
      const href = linkEl.attr("href") || "";
      const chapterId = href.replace(BASE_URL, "");
      const rawTitle = linkEl.find("span").first().text().trim() || linkEl.text().trim();

      // Estrae il numero del capitolo dal testo (es. "Capitolo 104.5" -> 104.5)
      const numMatch = rawTitle.match(/(\d+(?:\.\d+)?)/);
      const number = numMatch ? parseFloat(numMatch[1]) : chapterElements.length - index;

      chapters.push({
        chapterId,
        number,
        title: rawTitle,
        index,
        date: new Date(),
        language: "it",
      });
    });

    return chapters;
  }

  // 4. Pagine del singolo Capitolo
  async getChapterData(
    contentId: string,
    chapterId: string
  ): Promise<ChapterData> {
    // Aggiunge ?style=list per caricare tutte le immagini della pagina in un colpo solo
    const baseChapterUrl = chapterId.startsWith("http")
      ? chapterId
      : `${BASE_URL}${chapterId}`;
    const url = baseChapterUrl.includes("?")
      ? `${baseChapterUrl}&style=list`
      : `${baseChapterUrl}?style=list`;

    const $ = await this.fetchHTML(url);
    const pages: { url: string }[] = [];

    $("#page img.page-image").each((_, el) => {
      const imgUrl = $(el).attr("src") || $(el).attr("data-src");
      if (imgUrl && imgUrl.startsWith("http")) {
        pages.push({ url: imgUrl.trim() });
      }
    });

    return {
      pages,
    };
  }

  // 5. Tag/Generi (opzionale, restituito vuoto per evitare errori di compilazione)
  async getSourceTags(): Promise<Property[]> {
    return [];
  }
}

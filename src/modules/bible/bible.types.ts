export interface BibleVersionApiModel {
  code: string;
  name: string;
  language: string;
}

export interface BookApiModel {
  name: string;
  abbrev: string;
  chapters: number;
  testament: string;
}

export interface VerseApiModel {
  verse: string;
  number: number;
  id?: number;
  study?: string;
}

export interface GetVersesParams {
  versionCode: string;
  book: string;
  chapter: number;
  fromVerse: number;
  toVerse?: number;
}

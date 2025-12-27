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

export interface ChapterVerseApiModel {
  verse: string;
  number: number;
  id?: number;
  study?: string;
}

export interface ChapterApiModel {
  testament: string;
  name: string;
  num_chapters: number;
  chapter: number;
  vers: ChapterVerseApiModel[];
}

export interface ChapterVerse {
  number: number;
  text: string;
  study?: string;
  id?: number;
}

export interface Chapter {
  testament: string;
  name: string;
  numChapters: number;
  chapter: number;
  verses: ChapterVerse[];
}

export interface GetChapterParams {
  versionCode: string;
  book: string;
  chapter: number;
}

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

import axios, { AxiosInstance } from 'axios';
import { config } from '../../config/env';
import { BibleVersionApiModel, BookApiModel } from './bible.types';

const logAxiosError = (context: string, error: unknown) => {
  if (axios.isAxiosError(error)) {
    const { response, message, code } = error;
    // eslint-disable-next-line no-console
    console.error(`[BibleApiClient] ${context} failed`, {
      status: response?.status,
      data: response?.data,
      message,
      code,
    });
  } else {
    // eslint-disable-next-line no-console
    console.error(`[BibleApiClient] ${context} failed`, error);
  }
};

export class BibleApiClient {
  private client: AxiosInstance;

  constructor(baseUrl = config.external.bibleApiBaseUrl) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
    });
  }

  async getVersions(): Promise<BibleVersionApiModel[]> {
    const path = '/versions';
    try {
      const { data } = await this.client.get<BibleVersionApiModel[]>(path);
      return data;
    } catch (error) {
      logAxiosError(path, error);
      throw new Error('Failed to fetch bible versions');
    }
  }

  async getBooks(): Promise<BookApiModel[]> {
    const path = '/books';
    try {
      const { data } = await this.client.get<BookApiModel[]>(path);
      return data;
    } catch (error) {
      logAxiosError(path, error);
      throw new Error('Failed to fetch bible books');
    }
  }
}

export default BibleApiClient;

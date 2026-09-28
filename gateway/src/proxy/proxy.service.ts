import { HttpException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError, Method } from 'axios';

/**
 * Cœur de la gateway : relaie une requête vers un service en aval
 * et renvoie sa réponse telle quelle (proxy). AUCUNE logique métier ici.
 */
@Injectable()
export class ProxyService {
  constructor(private readonly http: HttpService) {}

  /**
   * @param baseUrl  URL du service cible (ex. http://localhost:3002)
   * @param path     chemin à appeler sur ce service (ex. /courses)
   * @param method   verbe HTTP (GET, POST, ...)
   * @param body     corps de la requête (pour POST/PUT/PATCH), sinon undefined
   */
  async forward(baseUrl: string, path: string, method: Method, body?: unknown) {
    try {
      const response = await firstValueFrom(
        this.http.request({
          url: `${baseUrl}${path}`,
          method,
          data: body,
        }),
      );
      return response.data;
    } catch (err) {
      // Le service en aval a répondu une erreur (404, 409, 422...) :
      // on la relaie au client avec le même code et le même corps.
      const axiosErr = err as AxiosError;
      if (axiosErr.response) {
        throw new HttpException(
          axiosErr.response.data as object,
          axiosErr.response.status,
        );
      }
      // Le service est injoignable (éteint, mauvaise URL...) : 502 Bad Gateway.
      throw new HttpException(
        { code: 'SERVICE_INDISPONIBLE', message: `Service injoignable: ${baseUrl}` },
        502,
      );
    }
  }
}

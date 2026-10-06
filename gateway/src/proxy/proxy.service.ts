import { HttpException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError, Method } from 'axios';

/**
 * Coeur de la gateway : relaie une requete vers un service en aval
 * et renvoie sa reponse telle quelle (proxy). AUCUNE logique metier ici.
 *
 * Les headers passes (ex. Authorization, X-User-Id, X-User-Role) sont
 * transmis au service en aval : utile pour la propagation d'identite.
 */
@Injectable()
export class ProxyService {
  constructor(private readonly http: HttpService) {}

  /**
   * @param baseUrl  URL du service cible (ex. http://localhost:3002)
   * @param path     chemin a appeler sur ce service (ex. /courses)
   * @param method   verbe HTTP (GET, POST, ...)
   * @param body     corps de la requete (pour POST/PUT/PATCH), sinon undefined
   * @param headers  headers additionnels a propager (identite, auth...)
   */
  async forward(
    baseUrl: string,
    path: string,
    method: Method,
    body?: unknown,
    headers?: Record<string, string>,
  ) {
    try {
      const response = await firstValueFrom(
        this.http.request({
          url: `${baseUrl}${path}`,
          method,
          data: body,
          headers,
          // On veut relayer tous les codes (y compris 204) sans qu'axios ne jette
          validateStatus: () => true,
        }),
      );

      // Erreur en aval : on relaie code + corps a l'identique
      if (response.status >= 400) {
        throw new HttpException(
          response.data as object,
          response.status,
        );
      }
      return response.data;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const axiosErr = err as AxiosError;
      if (axiosErr.response) {
        throw new HttpException(
          axiosErr.response.data as object,
          axiosErr.response.status,
        );
      }
      // Service injoignable (eteint, mauvaise URL...) : 502 Bad Gateway.
      throw new HttpException(
        { code: 'SERVICE_INDISPONIBLE', message: `Service injoignable: ${baseUrl}` },
        502,
      );
    }
  }
}

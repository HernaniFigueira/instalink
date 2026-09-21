/** Status, not arbitrary HTML or exception text, determines the user-facing failure. */
export function loginFailure(status: number, confirmingSession = false): string {
  if (status === 429) return 'Muitas tentativas de login. Aguarde um minuto antes de tentar novamente.';
  if (status >= 500) return 'O serviço de acesso está temporariamente indisponível. Tente novamente em instantes.';
  if (status === 401) return confirmingSession
    ? 'A sessão não pôde ser confirmada. Entre novamente para continuar.'
    : 'E-mail ou senha incorretos.';
  if (status === 400) return 'Confira os campos de e-mail e senha e tente novamente.';
  return 'Não foi possível concluir o acesso. Tente novamente.';
}
export const LOGIN_NETWORK_FAILURE = 'Não foi possível conectar ao serviço de acesso. Verifique sua conexão e tente novamente.';

# LoL Config Swap

Console app que leva suas configurações do League of Legends (jogo + client) para a conta de outra pessoa e depois devolve as configs originais dela.

Funciona pela API local do client (LCU). Não toca no processo do jogo.

## Download

Baixe o `LolConfigSwap.exe` na página de [Releases](../../releases/latest). Não precisa instalar nada.

O `.exe` não é assinado, então o Windows SmartScreen pode avisar na primeira execução: clique em **Mais informações → Executar assim mesmo**.

## Uso

Dê dois cliques no `.exe` para abrir o menu, ou use pelo terminal:

1. Logue na **sua** conta e rode `LolConfigSwap salvar eu` (uma vez só, ou quando mudar suas configs).
2. Logue na conta do amigo e rode `LolConfigSwap aplicar eu`. Antes, o app salva um backup das configs dele.
3. Jogue.
4. Com o client fora de partida, rode `LolConfigSwap restaurar`. As configs originais do amigo voltam.

Sem argumentos, abre um menu. Outros comandos: `status`, `perfis`.

## O que é trocado

- Jogo: `game-settings` (áudio, vídeo, HUD, mouse, interface) e `input-settings` (atalhos).
- Client: todas as categorias salvas na conta (`/lol-settings/v1/account/*`).
- Configs locais do client (volume e vídeo do client) ficam no PC e não mudam com a conta, então não entram.

## Segurança

- O backup fica em `%LOCALAPPDATA%\LolConfigSwap\backups\<puuid>.json` e **nunca é sobrescrito**: aplicar duas vezes mantém o original.
- Depois de restaurar, o backup vai para `backups\restaurados\`.
- `aplicar` e `restaurar` recusam rodar com partida em andamento.
- Se o client fechar no meio, basta logar de novo na conta e rodar `restaurar`.
- Se o LoL estiver fora de `C:\Riot Games\League of Legends` e o client não for encontrado, defina a variável `LOL_PATH`.

## Build

Requer o SDK do .NET 10. Gera um único `.exe` autocontido em `publish/`:

```bash
dotnet publish -c Release -o publish
```

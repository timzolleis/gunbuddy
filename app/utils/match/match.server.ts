import type { Player, ValorantMatchDetails } from '~/models/valorant/match/ValorantMatchDetails';
import { ValorantApiClient } from '~/utils/valorant-api/ValorantApiClient';
import type { ValorantApiMap } from '~/models/valorant-api/ValorantApiMap';
import { valorantApiEndpoints } from '~/config/valorantApiEndpoints';
import { RiotRequest } from '~/models/Request';
import { endpoints } from '~/config/endpoints';
import { RiotGamesApiClient } from '~/utils/riot/RiotGamesApiClient';
import type { ValorantUser } from '~/models/user/ValorantUser';
import type { ValorantApiCharacter } from '~/models/valorant-api/ValorantApiCharacter';
import { prisma } from '~/utils/db/db.server';

export async function getMatchMap(mapId: string) {
    const maps = await new ValorantApiClient().getDatabaseCached<ValorantApiMap[]>(
        valorantApiEndpoints.maps,
        {
            key: 'maps',
            expiration: 3600,
        }
    );
    const result = maps.find((map) => {
        return map.mapUrl === mapId;
    });
    if (!result) {
        throw new Error('Map not found!');
    }
    return result;
}

export async function getMatchDetails(user: ValorantUser, matchId: string) {
    const riotRequest = new RiotRequest(user.userData.region).buildBaseUrl(
        endpoints.match.details(matchId)
    );
    return await new RiotGamesApiClient(
        user.accessToken,
        user.entitlement
    ).getDatabaseCached<ValorantMatchDetails>(riotRequest, {
        key: 'match-details',
        expiration: 3600,
    });
}

export async function analyzeMatch(user: ValorantUser, matchId: string) {
    const details = await getMatchDetails(user, matchId);
    for (const player of details.players) {
        await storePlayerPerformance(user, player, details);
    }
}

async function storePlayerPerformance(
    user: ValorantUser,
    player: Player,
    details: ValorantMatchDetails
) {
    const playerGameStats = await prisma.playerGameStats.findUnique({
        where: {
            puuid_matchId: {
                puuid: player.subject,
                matchId: details.matchInfo.matchId,
            },
        },
    });
    if (playerGameStats) return;
    const { headShots, bodyShots, legShots } = getPlayerShotsInMatch(player.subject, details);
    await prisma.playerGameStats.create({
        data: {
            matchId: details.matchInfo.matchId,
            puuid: player.subject,
            score: player.stats.score,
            kills: player.stats.kills,
            deaths: player.stats.deaths,
            assists: player.stats.assists,
            currentRank: player.competitiveTier,
            characterUuid: player.characterId,
            teamId: player.teamId,
            roundsPlayed: player.stats.roundsPlayed,
            headShots: headShots,
            bodyShots: bodyShots,
            legShots: legShots,
            totalShots: headShots + bodyShots + legShots,
        },
    });
}

function getPlayerShotsInMatch(puuid: string, details: ValorantMatchDetails) {
    const relevantPlayerStats = details.roundResults.map((roundResult) => {
        return roundResult.playerStats.filter((playerStats) => {
            return playerStats.subject === puuid;
        });
    });
    let headShots = 0;
    let bodyShots = 0;
    let legShots = 0;
    relevantPlayerStats.forEach((statistics) => {
        statistics.forEach((playerStats) => {
            const roundHeadshotsArray = playerStats.damage.map((damage) => damage.headshots);
            const roundBodyShotsArray = playerStats.damage.map((damage) => damage.bodyshots);
            const roundLegShotsArray = playerStats.damage.map((damage) => damage.legshots);
            if (roundHeadshotsArray.length > 0) {
                headShots += roundHeadshotsArray.reduce(sum);
            }
            if (roundBodyShotsArray.length > 0) {
                bodyShots += roundBodyShotsArray.reduce(sum);
            }
            if (roundLegShotsArray.length > 0) {
                legShots += roundLegShotsArray.reduce(sum);
            }
        });
    });

    return { headShots, bodyShots, legShots };
}

export async function getCharacterByUUid(characterId: string | undefined) {
    if (!characterId) return null;
    return await new ValorantApiClient().getDatabaseCached<ValorantApiCharacter>(
        valorantApiEndpoints.characterByUuid(characterId),
        {
            key: 'character',
            expiration: 3600,
        }
    );
}

function sum(a: number, b: number) {
    return a + b;
}

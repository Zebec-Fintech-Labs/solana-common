import BigNumber from "bignumber.js";
// import { web3 } from "@coral-xyz/anchor";
import { assert } from "console";

import { replaceNonZeroAndSortPrioritizationFeesAsc } from "../src";

// const connection = new web3.Connection("https://api.mainnet-beta.solana.com");
describe("replaceNonZeroAndSortPrioritizationFeesAsc", () => {
	it("should sort array in ascending removing NaNs", async () => {
		const fees = [
			{
				prioritizationFee: NaN,
				slot: 338801267,
			},
			{
				prioritizationFee: 1904,
				slot: 338801267,
			},
			{
				prioritizationFee: 8514,
				slot: 338801268,
			},
			{
				prioritizationFee: 976832,
				slot: 338801269,
			},
			{
				prioritizationFee: 2584,
				slot: 338801270,
			},
			{
				prioritizationFee: 1769,
				slot: 338801271,
			},
			{
				prioritizationFee: 4366,
				slot: 338801272,
			},
			{
				prioritizationFee: 0,
				slot: 338801273,
			},
			{
				prioritizationFee: 0,
				slot: 338801274,
			},
			{
				prioritizationFee: 10934,
				slot: 338801275,
			},
			{
				prioritizationFee: 166667,
				slot: 338801276,
			},
			{
				prioritizationFee: 1488,
				slot: 338801277,
			},
			{
				prioritizationFee: 7088,
				slot: 338801278,
			},
			{
				prioritizationFee: 4367,
				slot: 338801279,
			},
			{
				prioritizationFee: 1507,
				slot: 338801280,
			},
			{
				prioritizationFee: 1047,
				slot: 338801281,
			},
			{
				prioritizationFee: 11890,
				slot: 338801282,
			},
			{
				prioritizationFee: 1271,
				slot: 338801283,
			},
			{
				prioritizationFee: 9528,
				slot: 338801284,
			},
			{
				prioritizationFee: 8315,
				slot: 338801285,
			},
			{
				prioritizationFee: 6537,
				slot: 338801286,
			},
			{
				prioritizationFee: 2840,
				slot: 338801287,
			},
			{
				prioritizationFee: 19243,
				slot: 338801288,
			},
			{
				prioritizationFee: 108519,
				slot: 338801289,
			},
			{
				prioritizationFee: 0,
				slot: 338801290,
			},
			{
				prioritizationFee: 199326,
				slot: 338801291,
			},
			{
				prioritizationFee: 14857,
				slot: 338801292,
			},
			{
				prioritizationFee: 9882,
				slot: 338801293,
			},
			{
				prioritizationFee: 6877,
				slot: 338801294,
			},
			{
				prioritizationFee: 631944,
				slot: 338801295,
			},
			{
				prioritizationFee: 3653,
				slot: 338801296,
			},
			{
				prioritizationFee: 1003,
				slot: 338801297,
			},
			{
				prioritizationFee: 100000,
				slot: 338801298,
			},
			{
				prioritizationFee: 1843,
				slot: 338801299,
			},
			{
				prioritizationFee: 1583908,
				slot: 338801300,
			},
			{
				prioritizationFee: 19226,
				slot: 338801301,
			},
			{
				prioritizationFee: 5260,
				slot: 338801302,
			},
			{
				prioritizationFee: 7101,
				slot: 338801303,
			},
			{
				prioritizationFee: 6460,
				slot: 338801304,
			},
			{
				prioritizationFee: 187015,
				slot: 338801305,
			},
			{
				prioritizationFee: 6153,
				slot: 338801306,
			},
			{
				prioritizationFee: 4574,
				slot: 338801307,
			},
			{
				prioritizationFee: 5719,
				slot: 338801308,
			},
			{
				prioritizationFee: 3575,
				slot: 338801309,
			},
			{
				prioritizationFee: 2598,
				slot: 338801310,
			},
			{
				prioritizationFee: 4387,
				slot: 338801311,
			},
			{
				prioritizationFee: 4366,
				slot: 338801312,
			},
			{
				prioritizationFee: 0,
				slot: 338801313,
			},
			{
				prioritizationFee: 165310,
				slot: 338801314,
			},
			{
				prioritizationFee: 0,
				slot: 338801315,
			},
			{
				prioritizationFee: 7950,
				slot: 338801316,
			},
			{
				prioritizationFee: 5637,
				slot: 338801317,
			},
			{
				prioritizationFee: 5706,
				slot: 338801318,
			},
			{
				prioritizationFee: 2693,
				slot: 338801319,
			},
			{
				prioritizationFee: 14998,
				slot: 338801320,
			},
			{
				prioritizationFee: 6379,
				slot: 338801321,
			},
			{
				prioritizationFee: 2000000,
				slot: 338801322,
			},
			{
				prioritizationFee: 2846,
				slot: 338801323,
			},
			{
				prioritizationFee: 179211,
				slot: 338801324,
			},
			{
				prioritizationFee: 120232,
				slot: 338801325,
			},
			{
				prioritizationFee: 23610,
				slot: 338801326,
			},
			{
				prioritizationFee: 23721,
				slot: 338801327,
			},
			{
				prioritizationFee: 166667,
				slot: 338801328,
			},
			{
				prioritizationFee: 10552,
				slot: 338801329,
			},
			{
				prioritizationFee: 18877,
				slot: 338801330,
			},
			{
				prioritizationFee: 6710,
				slot: 338801331,
			},
			{
				prioritizationFee: 3977,
				slot: 338801332,
			},
			{
				prioritizationFee: 7602,
				slot: 338801333,
			},
			{
				prioritizationFee: 2013,
				slot: 338801334,
			},
			{
				prioritizationFee: 3171,
				slot: 338801335,
			},
			{
				prioritizationFee: 0,
				slot: 338801336,
			},
			{
				prioritizationFee: 61184,
				slot: 338801337,
			},
			{
				prioritizationFee: 1200000,
				slot: 338801338,
			},
			{
				prioritizationFee: 48509,
				slot: 338801339,
			},
			{
				prioritizationFee: 57463,
				slot: 338801340,
			},
			{
				prioritizationFee: 18290,
				slot: 338801341,
			},
			{
				prioritizationFee: 12083,
				slot: 338801342,
			},
			{
				prioritizationFee: 11846,
				slot: 338801343,
			},
			{
				prioritizationFee: 4077,
				slot: 338801344,
			},
			{
				prioritizationFee: 183582,
				slot: 338801345,
			},
			{
				prioritizationFee: 6599,
				slot: 338801346,
			},
			{
				prioritizationFee: 2447,
				slot: 338801347,
			},
			{
				prioritizationFee: 2000000,
				slot: 338801348,
			},
			{
				prioritizationFee: 5560,
				slot: 338801349,
			},
			{
				prioritizationFee: 2402,
				slot: 338801350,
			},
			{
				prioritizationFee: 3212,
				slot: 338801351,
			},
			{
				prioritizationFee: 1792544,
				slot: 338801352,
			},
			{
				prioritizationFee: 20539,
				slot: 338801353,
			},
			{
				prioritizationFee: 18837,
				slot: 338801354,
			},
			{
				prioritizationFee: 15954,
				slot: 338801355,
			},
			{
				prioritizationFee: 47161,
				slot: 338801356,
			},
			{
				prioritizationFee: 26586,
				slot: 338801357,
			},
			{
				prioritizationFee: 17969,
				slot: 338801358,
			},
			{
				prioritizationFee: 24722,
				slot: 338801359,
			},
			{
				prioritizationFee: 2182,
				slot: 338801360,
			},
			{
				prioritizationFee: 20,
				slot: 338801361,
			},
			{
				prioritizationFee: 1258,
				slot: 338801362,
			},
			{
				prioritizationFee: 1356,
				slot: 338801363,
			},
			{
				prioritizationFee: 26224,
				slot: 338801364,
			},
			{
				prioritizationFee: 7491,
				slot: 338801365,
			},
			{
				prioritizationFee: 13929,
				slot: 338801366,
			},
			{
				prioritizationFee: 3772,
				slot: 338801367,
			},
			{
				prioritizationFee: 0,
				slot: 338801368,
			},
			{
				prioritizationFee: 26178,
				slot: 338801369,
			},
			{
				prioritizationFee: 0,
				slot: 338801370,
			},
			{
				prioritizationFee: 16435,
				slot: 338801371,
			},
			{
				prioritizationFee: 186113,
				slot: 338801372,
			},
			{
				prioritizationFee: 166667,
				slot: 338801373,
			},
			{
				prioritizationFee: 15277,
				slot: 338801374,
			},
			{
				prioritizationFee: 11254,
				slot: 338801375,
			},
			{
				prioritizationFee: 11174,
				slot: 338801376,
			},
			{
				prioritizationFee: 11986,
				slot: 338801377,
			},
			{
				prioritizationFee: 8811,
				slot: 338801378,
			},
			{
				prioritizationFee: 7163,
				slot: 338801379,
			},
			{
				prioritizationFee: 6563,
				slot: 338801380,
			},
			{
				prioritizationFee: 742,
				slot: 338801381,
			},
			{
				prioritizationFee: 1465,
				slot: 338801382,
			},
			{
				prioritizationFee: 1861,
				slot: 338801383,
			},
			{
				prioritizationFee: 10000000,
				slot: 338801384,
			},
			{
				prioritizationFee: 0,
				slot: 338801385,
			},
			{
				prioritizationFee: 10000000,
				slot: 338801386,
			},
			{
				prioritizationFee: 137134,
				slot: 338801387,
			},
			{
				prioritizationFee: 10000000,
				slot: 338801388,
			},
			{
				prioritizationFee: 6112,
				slot: 338801389,
			},
			{
				prioritizationFee: 1374,
				slot: 338801390,
			},
			{
				prioritizationFee: 4628,
				slot: 338801391,
			},
			{
				prioritizationFee: 103086,
				slot: 338801392,
			},
			{
				prioritizationFee: 15236,
				slot: 338801393,
			},
			{
				prioritizationFee: 10827,
				slot: 338801394,
			},
			{
				prioritizationFee: 166667,
				slot: 338801395,
			},
			{
				prioritizationFee: 16245,
				slot: 338801396,
			},
			{
				prioritizationFee: 166667,
				slot: 338801397,
			},
			{
				prioritizationFee: 14219,
				slot: 338801398,
			},
			{
				prioritizationFee: 7680,
				slot: 338801399,
			},
			{
				prioritizationFee: 2465,
				slot: 338801400,
			},
			{
				prioritizationFee: 3031,
				slot: 338801401,
			},
			{
				prioritizationFee: 6579,
				slot: 338801402,
			},
			{
				prioritizationFee: 5071,
				slot: 338801403,
			},
			{
				prioritizationFee: 31046,
				slot: 338801404,
			},
			{
				prioritizationFee: 0,
				slot: 338801405,
			},
			{
				prioritizationFee: 83143,
				slot: 338801406,
			},
			{
				prioritizationFee: 27147,
				slot: 338801407,
			},
			{
				prioritizationFee: 3515,
				slot: 338801408,
			},
			{
				prioritizationFee: 2428,
				slot: 338801409,
			},
			{
				prioritizationFee: 1190,
				slot: 338801410,
			},
			{
				prioritizationFee: 3498,
				slot: 338801411,
			},
			{
				prioritizationFee: 19201,
				slot: 338801412,
			},
			{
				prioritizationFee: 27711,
				slot: 338801413,
			},
			{
				prioritizationFee: 23024,
				slot: 338801414,
			},
			{
				prioritizationFee: 18095,
				slot: 338801415,
			},
			{
				prioritizationFee: 14055,
				slot: 338801416,
			},
		];

		const sorted = replaceNonZeroAndSortPrioritizationFeesAsc(fees);

		assert(
			BigNumber(sorted[0].prioritizationFee).comparedTo(sorted[1].prioritizationFee) === -1,
			"Array is not sorted in ascending",
		);
		assert(sorted.some((item) => !Number.isNaN(item.prioritizationFee)));
	});
});

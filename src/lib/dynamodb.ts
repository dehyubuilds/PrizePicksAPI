import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { config } from "@/lib/config";

const clientConfig: DynamoDBClientConfig = { region: config.dynamo.region };
if (config.aws.accessKeyId && config.aws.secretAccessKey) {
  clientConfig.credentials = {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  };
}

const client = new DynamoDBClient(clientConfig);
/** Strip `undefined` from Put/Batch writes — required for optional fields (e.g. Signal Cut videos before classify). */
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export function getTable(name: keyof typeof config.dynamo.tables): string {
  const table = config.dynamo.tables[name];
  if (!table) throw new Error(`Missing DynamoDB table config: ${name}`);
  return table;
}

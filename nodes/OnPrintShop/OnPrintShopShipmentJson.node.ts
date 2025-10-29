import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject,
} from 'n8n-workflow';

export class OnPrintShopShipmentJson implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OnPrintShop Shipment (JSON)',
		name: 'onPrintShopShipmentJson',
		icon: 'file:onprintshop.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Create Shipment with JSON',
		description: 'Create OnPrintShop shipment using JSON input',
		defaults: {
			name: 'OnPrintShop Shipment (JSON)',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'onPrintShopApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Order ID',
				name: 'orderId',
				type: 'number',
				required: true,
				default: 0,
				description: 'The ID of the order',
			},
			{
				displayName: 'Shipment ID',
				name: 'shipmentId',
				type: 'number',
				required: true,
				default: 0,
				description: 'The ID of the shipment',
			},
			{
				displayName: 'Tracking Number',
				name: 'trackingNumber',
				type: 'string',
				required: true,
				default: '',
				description: 'Tracking number for the shipment',
			},
			{
				displayName: 'Shipment Info (JSON)',
				name: 'shipmentInfoJson',
				type: 'json',
				required: true,
				default: '[{"packageinfo": [{"weight": 0, "length": 0, "width": 0, "height": 0, "tracking": "", "opdata": [{"opid": 0, "qty": "0"}]}]}]',
				description: 'JSON array with shipment package information',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];

		// Get credentials
		const credentials = await this.getCredentials('onPrintShopApi');
		const baseUrl = (credentials.baseUrl as string) || 'https://api.onprintshop.com';
		const tokenUrl = (credentials.tokenUrl as string) || 'https://api.onprintshop.com/oauth/token';
		const clientId = credentials.clientId as string;
		const clientSecret = credentials.clientSecret as string;

		// Get OAuth2 access token
		let accessToken: string;
		try {
			const tokenResponse = await this.helpers.request({
				method: 'POST',
				url: tokenUrl,
				headers: {
					'Content-Type': 'application/json',
				},
				body: {
					grant_type: 'client_credentials',
					client_id: clientId,
					client_secret: clientSecret,
				},
				json: true,
			});
			accessToken = tokenResponse.access_token;
		} catch (error) {
			throw new NodeOperationError(this.getNode(), `Failed to get access token: ${error.message}`);
		}

		// Process each item
		for (let i = 0; i < items.length; i++) {
			try {
				const orderId = this.getNodeParameter('orderId', i) as number;
				const shipmentId = this.getNodeParameter('shipmentId', i) as number;
				const trackingNumber = this.getNodeParameter('trackingNumber', i) as string;
				const shipmentInfoJson = this.getNodeParameter('shipmentInfoJson', i);

				let shipmentinfo: IDataObject[];

				// Parse JSON if string, otherwise use as-is
				if (typeof shipmentInfoJson === 'string') {
					try {
						shipmentinfo = JSON.parse(shipmentInfoJson);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid JSON format for Shipment Info: ${error.message}`,
						);
					}
				} else {
					shipmentinfo = shipmentInfoJson as IDataObject[];
				}

				// Validate structure
				if (!Array.isArray(shipmentinfo)) {
					throw new NodeOperationError(
						this.getNode(),
						'Shipment Info must be an array. Expected format: [{"packageinfo": [...]}]',
					);
				}

				if (!shipmentinfo[0] || !shipmentinfo[0].packageinfo || !Array.isArray(shipmentinfo[0].packageinfo)) {
					throw new NodeOperationError(
						this.getNode(),
						'Shipment Info must contain packageinfo array. Expected: [{"packageinfo": [{"weight": 11, ...}]}]',
					);
				}

				// Build the GraphQL mutation
				const mutation = `
					mutation setShipment ($order_id: Int, $shipment_id: Int, $tracking_number: String, $shipmentinfo: JSON) {
						setShipment (order_id: $order_id, shipment_id: $shipment_id, tracking_number: $tracking_number, shipmentinfo: $shipmentinfo) {
							result
							message
						}
					}
				`;

				// Make the GraphQL request
				const responseData = await this.helpers.request({
					method: 'POST',
					url: `${baseUrl}/api/`,
					headers: {
						'Authorization': `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
					},
					body: {
						query: mutation.trim(),
						variables: {
							order_id: orderId,
							shipment_id: shipmentId,
							tracking_number: trackingNumber,
							shipmentinfo: shipmentinfo,
						},
					},
					json: true,
				});

				// Handle GraphQL response
				if (responseData && responseData.data && responseData.data.setShipment) {
					const result = responseData.data.setShipment;
					const packageinfo = shipmentinfo[0]?.packageinfo;
					const packagesCount = Array.isArray(packageinfo) ? packageinfo.length : 0;

					returnData.push({
						...result,
						_order_id: orderId,
						_shipment_id: shipmentId,
						_tracking_number: trackingNumber,
						_packages_count: packagesCount,
						_shipmentinfo: shipmentinfo,
					});
				} else if (responseData && responseData.errors) {
					throw new NodeOperationError(
						this.getNode(),
						`GraphQL Error: ${JSON.stringify(responseData.errors)}`,
					);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unexpected response format. Response: ${JSON.stringify(responseData)}`,
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}





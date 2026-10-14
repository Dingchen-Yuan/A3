// API pool sheet: API_SALES_ORDER_SRV, GET with $top=5, $select and $expand.
const SALES_ORDER_PATH = "/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder?$top=5&$select=SalesOrder,SoldToParty,TotalNetAmount,RequestedDeliveryDate,OverallDeliveryStatus&$expand=to_Item";

module.exports = { SALES_ORDER_PATH };

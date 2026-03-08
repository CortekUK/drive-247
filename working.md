OK so we have a task in which we have to also makes changes but make sure in the end the whole flow is working completely and seamlessly, the flow will have multiple things working together, I am talking about the "Rental Extension functionality" and its complete workflow.So we will talk about it in bullet points about what key things we have to consider with making it proper

1. 1st this is that as we are tracking the payments of a customer through his Payment breakdown function, like whatdues he has and the payment and refund. But for now the 1st table is for the original 1st time the rental was made for that customer

2. I want the extention data, to be like when the rental is extended, it will create a new table just like this one which will hold the values of only the ectended time, make sure the logic in it is also correct, you can look at the already existing logic of the rental creaation and update the new one according to it

3. Each new extension for the same rental will have a new table as its record and it will show witht the table that it is for the extended rental and which number of extention is it, like if the user has extended 2nd time then the new table for it will show professionally that it is for the second extension.

4. The original table will be as it is but as more tables will be added for the Payment Breakdown, they will become collapseable, and originally the 1st will be open and rest will be collapsed and only one at a time can be uncollapsed and rest will collapse if any other was open

5. rest to that after extension we will want to generate a new agreement document that will again will be sent to the user. We will have to hard code a field in the start of the document that will show you that it was for the original agreement for the first time of this rental or it for whcih number of extension

6. triple check the calculations and everyhting properly, we cant make mistakes in them
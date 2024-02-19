import Stripe from 'stripe'

const stripeApiKey = Deno.env.get('STRIPE_API_KEY')
const stripeWebhookSigningSecret = Deno.env.get('STRIPE_NOTIFIER_WEBHOOK_SIGNING_SECRET')
const slackWebhookUrl = Deno.env.get('STRIPE_NOTIFIER_SLACK_CHANNEL_WEBHOOK_URL')

const stripe = new Stripe(stripeApiKey, {
    apiVersion: '2020-08-27',
    maxNetworkRetries: 3,
    // This is needed to use the Fetch API rather than relying on the Node http
    // package.
    httpClient: Stripe.createFetchHttpClient(),
})

// This is needed in order to use the Web Crypto API in Deno.
const cryptoProvider = Stripe.createSubtleCryptoProvider()

Deno.serve(async (request) => {
    // The .text() method must be used as the verification relies on the raw request body rather than the parsed JSON.
    const body = await request.text()
    const signature = request.headers.get('Stripe-Signature')

    let receivedEvent = Stripe.Event | undefined
    try {
        receivedEvent = await stripe.webhooks.constructEventAsync(
            body,
            signature!,
            stripeWebhookSigningSecret,
            null,
            cryptoProvider
        )
    } catch (error) {
        if (error instanceof Error) {
            return new Response(error.message, {status: 400})
        }
    }

    switch (receivedEvent?.type) {
        case 'radar.early_fraud_warning.created':
            await postEarlyFraudWarningCreated(receivedEvent)
            break
        default:
            console.log(`Unhandled event type ${receivedEvent.type}`)
    }

    return new Response(JSON.stringify({received: true}), {status: 200})
})

const postEarlyFraudWarningCreated = async (event: Stripe.Event) => {
    const earlyFraudWarning = event.data.object
    const reviewLink = `https://dashboard.stripe.com/payments/${earlyFraudWarning.charge}/review`

    const message = {
        "blocks":
            [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Early Fraud warning created*"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": `<${reviewLink}|View details>`
                    }
                }
            ]
    }

    const request = new Request(
        slackWebhookUrl,
        {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
        }
    )

    await fetch(request)
}


const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 9000;

const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    optionSuccessStatus: 200,
}

app.use(cors(corsOptions));
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4ldhpeq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Collection
        const mealCollection = client.db('hostelDB').collection('meals');
        const packageCollection = client.db('hostelDB').collection('packages');
        const paymentCollection = client.db('hostelDB').collection('payments');


        // jwt api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            console.log('User--->', user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' });
            console.log('Token--->', token);
            res.send({ token: token });
        })

        // payment api
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            console.log('Price--->', price);
            const amount = parseInt(price * 100);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            console.log('payment info', payment);

            res.send({ paymentResult });
        })

        // meals api
        app.get('/meals', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            try {
                const meals = await mealCollection.find().skip(skip).limit(limit).toArray();
                const totalMeals = await mealCollection.countDocuments();

                res.send({
                    meals,
                    totalMeals,
                    currentPage: page,
                    totalPages: Math.ceil(totalMeals / limit),
                    nextPage: page * limit < totalMeals ? page + 1 : null
                });
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch meals...' });
            }
        });

        app.get('/meal/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealCollection.findOne(query);
            res.send(result);
        })

        // package api 
        app.get('/packages', async (req, res) => {
            const result = await packageCollection.find().toArray();
            res.send(result);
        })

        app.get('/checkout/:package_name', async (req, res) => {
            const package = req.params.package_name;
            const query = { package_name: package };
            const result = await packageCollection.findOne(query);
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Server is running...');
});

app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});




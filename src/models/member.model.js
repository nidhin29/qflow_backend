const memberSchema = new Schema(
    {
        name: {
            type: String,
            required: true
        },
        age: {
            type: Number,
            required: true
        },
        gender: {
            type: String,
            enum: ["male", "female", "other"],
            required: true
        },
        profile_image: {
            type: String
        },
        weight: {
            type: Number,
            required: true
        },
        height: {
            type: Number,
            required: true
        }, 
        relation: {
            type: String,
            required: true
        },
        blood_group: {
            type: String,
            required: true
        }, 
    },
    { timestamps: true }
);

export const Member = mongoose.model("Member", memberSchema);